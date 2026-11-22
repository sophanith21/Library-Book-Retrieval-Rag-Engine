import { Inject, Injectable } from '@nestjs/common';
import { KNOWLEDGE_POOL } from '@app/knowledge-db';
import { Pool } from 'pg';
import { TermSpan } from './snippet';

export interface BookHit {
  bookId: string;
  title: string | null;
  author: string | null;
  chunkId: string;
  chapterNo: number;
  chunkNo: number;
  content: string;
  score: number;
  matchedTerms: number;
}

@Injectable()
export class Bm25SearchRepository {
  constructor(@Inject(KNOWLEDGE_POOL) private readonly pool: Pool) {}

  /** Dictionary lookup: normalised term -> term id (unknown terms are dropped). */
  async lookupTerms(terms: string[]): Promise<Map<string, number>> {
    const { rows } = await this.pool.query<{ id: number; term: string }>(
      'SELECT id, term FROM knowledge.terms WHERE term = ANY($1::text[])',
      [terms],
    );
    return new Map(rows.map((r) => [r.term, r.id]));
  }

  /**
   * Rank books by BM25, one row per book.
   *
   * Chunk score = sum of the precomputed bm25_weight of each matching query
   * term. A book's score is its best chunk's score (max-passage ranking),
   * and that chunk becomes the result's snippet source.
   */
  async rankBooks(
    termIds: number[],
    limit: number,
    offset: number,
  ): Promise<{ total: number; hits: BookHit[] }> {
    const { rows } = await this.pool.query<{
      book_id: string;
      title: string | null;
      author: string | null;
      chunk_id: string;
      chapter_no: number;
      chunk_no: number;
      content: string;
      score: number;
      matched_terms: number;
      total: string;
    }>(
      `WITH chunk_scores AS (
         -- bm25_weight is NULL until refresh_index_stats() has run
         SELECT chunk_id, book_id,
                coalesce(sum(bm25_weight), 0)::float8 AS score,
                count(*)::int                         AS matched_terms
           FROM knowledge.postings
          WHERE term_id = ANY($1::int[])
          GROUP BY chunk_id, book_id
       ), best_chunk AS (
         SELECT DISTINCT ON (book_id) book_id, chunk_id, score, matched_terms
           FROM chunk_scores
          ORDER BY book_id, score DESC, matched_terms DESC, chunk_id
       ), page AS (
         SELECT *, count(*) OVER () AS total
           FROM best_chunk
          ORDER BY score DESC, book_id
          LIMIT $2 OFFSET $3
       )
       SELECT p.book_id, ib.title, ib.author, p.chunk_id, c.chapter_no,
              c.chunk_no, c.content, p.score, p.matched_terms, p.total
         FROM page p
         JOIN knowledge.chunks c ON c.id = p.chunk_id
         LEFT JOIN knowledge.indexed_books ib ON ib.book_id = p.book_id
        ORDER BY p.score DESC, p.book_id`,
      [termIds, limit, offset],
    );

    return {
      total: rows.length > 0 ? Number(rows[0].total) : 0,
      hits: rows.map((r) => ({
        bookId: r.book_id,
        title: r.title,
        author: r.author,
        chunkId: r.chunk_id,
        chapterNo: r.chapter_no,
        chunkNo: r.chunk_no,
        content: r.content,
        score: r.score,
        matchedTerms: r.matched_terms,
      })),
    };
  }

  /**
   * Where each query term occurs in the given chunks, as character spans,
   * straight from the postings' stored offsets.
   */
  async termSpans(
    chunkIds: string[],
    termIds: number[],
  ): Promise<Map<string, TermSpan[]>> {
    const { rows } = await this.pool.query<{
      chunk_id: string;
      term: string;
      char_starts: number[];
      char_ends: number[];
    }>(
      `SELECT p.chunk_id, t.term, p.char_starts, p.char_ends
         FROM knowledge.postings p
         JOIN knowledge.terms t ON t.id = p.term_id
        WHERE p.chunk_id = ANY($1::bigint[])
          AND p.term_id  = ANY($2::int[])`,
      [chunkIds, termIds],
    );

    const byChunk = new Map<string, TermSpan[]>();
    for (const r of rows) {
      const spans = byChunk.get(r.chunk_id) ?? [];
      r.char_starts.forEach((start, i) =>
        spans.push({ start, end: r.char_ends[i], term: r.term }),
      );
      byChunk.set(r.chunk_id, spans);
    }
    return byChunk;
  }
}
