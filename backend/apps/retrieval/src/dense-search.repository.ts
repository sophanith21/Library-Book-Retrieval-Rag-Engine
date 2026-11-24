import { Inject, Injectable } from '@nestjs/common';
import { KNOWLEDGE_POOL } from '@app/knowledge-db';
import { toPgVectorSql } from '@app/embeddings';
import { Pool } from 'pg';

export interface DenseChunkHit {
  chunkId: string;
  bookId: string;
  title: string | null;
  author: string | null;
  chapterNo: number;
  chunkNo: number;
  content: string;
  similarity: number;
  rank: number;
}

export interface DenseBookHit {
  bookId: string;
  title: string | null;
  author: string | null;
  chunkId: string;
  chapterNo: number;
  chunkNo: number;
  content: string;
  score: number;
}

@Injectable()
export class DenseSearchRepository {
  constructor(@Inject(KNOWLEDGE_POOL) private readonly pool: Pool) {}

  /**
   * HNSW cosine similarity search over knowledge.chunks.
   * Returns top-K ranked chunks: [(chunk_K, rank=1), (chunk_A, rank=2), ...].
   */
  async rankChunks(
    queryEmbedding: number[],
    topK: number,
  ): Promise<DenseChunkHit[]> {
    const vecLiteral = toPgVectorSql(queryEmbedding);
    const { rows } = await this.pool.query<{
      chunk_id: string;
      book_id: string;
      title: string | null;
      author: string | null;
      chapter_no: number;
      chunk_no: number;
      content: string;
      similarity: number;
    }>(
      `SELECT c.id AS chunk_id,
              c.book_id,
              ib.title,
              ib.author,
              c.chapter_no,
              c.chunk_no,
              c.content,
              (1 - (c.embedding <=> $1::vector))::float8 AS similarity
         FROM knowledge.chunks c
         LEFT JOIN knowledge.indexed_books ib ON ib.book_id = c.book_id
        WHERE c.embedding IS NOT NULL
        ORDER BY c.embedding <=> $1::vector ASC
        LIMIT $2`,
      [vecLiteral, topK],
    );

    return rows.map((r, i) => ({
      chunkId: r.chunk_id,
      bookId: r.book_id,
      title: r.title,
      author: r.author,
      chapterNo: r.chapter_no,
      chunkNo: r.chunk_no,
      content: r.content,
      similarity: r.similarity,
      rank: i + 1,
    }));
  }

  /**
   * Rank books by dense cosine similarity (max-passage ranking, one row per book).
   *
   * Uses a bounded inner HNSW scan (candidateK chunks) so PostgreSQL uses the
   * chunks_embedding_idx HNSW index, then deduplicates by book_id.
   */
  async rankBooks(
    queryEmbedding: number[],
    limit: number,
    offset: number,
  ): Promise<{ total: number; hits: DenseBookHit[] }> {
    const vecLiteral = toPgVectorSql(queryEmbedding);
    const candidateK = Math.min(2000, Math.max(200, (limit + offset) * 10));

    const { rows } = await this.pool.query<{
      book_id: string;
      title: string | null;
      author: string | null;
      chunk_id: string;
      chapter_no: number;
      chunk_no: number;
      content: string;
      score: number;
      total: string;
    }>(
      `WITH ann_candidates AS (
         SELECT id AS chunk_id,
                book_id,
                chapter_no,
                chunk_no,
                content,
                (embedding <=> $1::vector) AS distance
           FROM knowledge.chunks
          WHERE embedding IS NOT NULL
          ORDER BY embedding <=> $1::vector ASC
          LIMIT $4
       ), best_chunk AS (
         SELECT DISTINCT ON (book_id)
                book_id, chunk_id, chapter_no, chunk_no, content,
                (1 - distance)::float8 AS score
           FROM ann_candidates
          ORDER BY book_id, distance ASC, chunk_id
       ), page AS (
         SELECT *, count(*) OVER () AS total
           FROM best_chunk
          ORDER BY score DESC, book_id
          LIMIT $2 OFFSET $3
       )
       SELECT p.book_id, ib.title, ib.author, p.chunk_id, p.chapter_no,
              p.chunk_no, p.content, p.score, p.total
         FROM page p
         LEFT JOIN knowledge.indexed_books ib ON ib.book_id = p.book_id
        ORDER BY p.score DESC, p.book_id`,
      [vecLiteral, limit, offset, candidateK],
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
      })),
    };
  }
}
