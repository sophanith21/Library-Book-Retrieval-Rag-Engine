import { Inject, Injectable } from '@nestjs/common';
import { BookIndexStatus, IndexStatsResponse } from '@app/contracts';
import { Pool, PoolClient } from 'pg';
import { KNOWLEDGE_POOL } from '@app/knowledge-db';
import { AnalyzedChunk } from './postings-builder';

export interface ChunkToIndex extends AnalyzedChunk {
  chapterNo: number;
  chunkNo: number;
  content: string;
}

// Rows per INSERT statement. Keeps each statement's parameters to a few MB.
const CHUNK_BATCH = 500;
const POSTING_BATCH = 5000;

/** Postgres array literal for an int[] column: [1,2,3] -> '{1,2,3}'. */
const intArrayLiteral = (values: number[]) => `{${values.join(',')}}`;

@Injectable()
export class InvertedIndexRepository {
  constructor(@Inject(KNOWLEDGE_POOL) private readonly pool: Pool) {}

  /**
   * Replace everything indexed for a book with the given chunks, in one
   * transaction. Re-indexing the same book is therefore idempotent.
   *
   * Leaves bm25_weight NULL on the new postings: corpus statistics are only
   * recomputed by refreshStats(), run once after a bulk load.
   */
  async replaceBook(
    book: { bookId: string; title?: string; author?: string },
    chunks: ChunkToIndex[],
  ): Promise<void> {
    const { bookId } = book;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Postings go with their chunks via ON DELETE CASCADE.
      await client.query('DELETE FROM knowledge.chunks WHERE book_id = $1', [
        bookId,
      ]);

      const chunkIds = await this.insertChunks(client, bookId, chunks);
      const termIds = await this.upsertTerms(client, chunks);
      await this.insertPostings(client, bookId, chunks, chunkIds, termIds);
      await this.scoreBookPostingsIncremental(client, bookId);

      // Track how many books were added/updated since the last full finalize
      await client.query(
        'UPDATE knowledge.index_stats SET dirty_books = dirty_books + 1',
      );

      const tokenTotal = chunks.reduce((sum, c) => sum + c.tokenCount, 0);
      await client.query(
        `INSERT INTO knowledge.indexed_books
                (book_id, title, author, status, chunk_count, token_count, error, indexed_at)
         VALUES ($1, $2, $3, 'done', $4, $5, NULL, now())
         ON CONFLICT (book_id) DO UPDATE
           SET title = EXCLUDED.title, author = EXCLUDED.author,
               status = 'done', chunk_count = EXCLUDED.chunk_count,
               token_count = EXCLUDED.token_count, error = NULL,
               indexed_at = EXCLUDED.indexed_at`,
        [
          bookId,
          book.title ?? null,
          book.author ?? null,
          chunks.length,
          tokenTotal,
        ],
      );

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /** Returns chunk ids in the same order as `chunks`. */
  private async insertChunks(
    client: PoolClient,
    bookId: string,
    chunks: ChunkToIndex[],
  ): Promise<string[]> {
    const ids: string[] = [];
    for (let i = 0; i < chunks.length; i += CHUNK_BATCH) {
      const batch = chunks.slice(i, i + CHUNK_BATCH);
      // WITH ORDINALITY + ORDER BY keeps RETURNING aligned with the input.
      const { rows } = await client.query<{ id: string }>(
        `WITH input AS (
           SELECT * FROM unnest($2::int[], $3::int[], $4::text[], $5::int[])
                    WITH ORDINALITY AS u(chapter_no, chunk_no, content, token_count, ord)
         ), inserted AS (
           INSERT INTO knowledge.chunks (book_id, chapter_no, chunk_no, content, token_count)
           SELECT $1, chapter_no, chunk_no, content, token_count FROM input ORDER BY ord
           RETURNING id, chapter_no, chunk_no
         )
         SELECT inserted.id
           FROM inserted
           JOIN input USING (chapter_no, chunk_no)
          ORDER BY input.ord`,
        [
          bookId,
          batch.map((c) => c.chapterNo),
          batch.map((c) => c.chunkNo),
          batch.map((c) => c.content),
          batch.map((c) => c.tokenCount),
        ],
      );
      ids.push(...rows.map((r) => r.id));
    }
    return ids;
  }

  /** Ensure every term exists in the dictionary; returns term -> id. */
  private async upsertTerms(
    client: PoolClient,
    chunks: ChunkToIndex[],
  ): Promise<Map<string, number>> {
    // Sorted so concurrent indexers lock dictionary rows in the same order.
    const terms = [
      ...new Set(chunks.flatMap((c) => c.postings.map((p) => p.term))),
    ].sort();

    // Insert only missing terms: ON CONFLICT alone would burn a sequence
    // value for every already-known term of every book.
    await client.query(
      `INSERT INTO knowledge.terms (term)
       SELECT t FROM unnest($1::text[]) AS t
        WHERE NOT EXISTS (SELECT 1 FROM knowledge.terms k WHERE k.term = t)
       ON CONFLICT (term) DO NOTHING`,
      [terms],
    );

    const { rows } = await client.query<{ id: number; term: string }>(
      'SELECT id, term FROM knowledge.terms WHERE term = ANY($1::text[])',
      [terms],
    );
    return new Map(rows.map((r) => [r.term, r.id]));
  }

  private async insertPostings(
    client: PoolClient,
    bookId: string,
    chunks: ChunkToIndex[],
    chunkIds: string[],
    termIds: Map<string, number>,
  ): Promise<void> {
    let termCol: number[] = [];
    let chunkCol: string[] = [];
    let tfCol: number[] = [];
    let posCol: string[] = [];
    let startCol: string[] = [];
    let endCol: string[] = [];

    const flush = async () => {
      if (termCol.length === 0) return;
      // Variable-length int[] per row can't go through unnest(int[][]), so
      // each array is sent as a '{..}' literal and cast back.
      await client.query(
        `INSERT INTO knowledge.postings
                (term_id, chunk_id, book_id, term_freq, positions, char_starts, char_ends)
         SELECT term_id, chunk_id, $1, tf, pos::int[], cs::int[], ce::int[]
           FROM unnest($2::int[], $3::bigint[], $4::int[], $5::text[], $6::text[], $7::text[])
                AS u(term_id, chunk_id, tf, pos, cs, ce)`,
        [bookId, termCol, chunkCol, tfCol, posCol, startCol, endCol],
      );
      termCol = [];
      chunkCol = [];
      tfCol = [];
      posCol = [];
      startCol = [];
      endCol = [];
    };

    for (let i = 0; i < chunks.length; i++) {
      for (const posting of chunks[i].postings) {
        termCol.push(termIds.get(posting.term)!);
        chunkCol.push(chunkIds[i]);
        tfCol.push(posting.positions.length);
        posCol.push(intArrayLiteral(posting.positions));
        startCol.push(intArrayLiteral(posting.charStarts));
        endCol.push(intArrayLiteral(posting.charEnds));
        if (termCol.length >= POSTING_BATCH) await flush();
      }
    }
    await flush();
  }

  /**
   * Assign approximate BM25 weights for ONLY this book's postings using the
   * cached corpus stats (avgdl, N, terms.idf), so a newly uploaded book is
   * immediately searchable without waiting for a full-corpus finalize.
   */
  private async scoreBookPostingsIncremental(
    client: PoolClient,
    bookId: string,
  ): Promise<void> {
    await client.query(
      `UPDATE knowledge.postings p
          SET bm25_weight =
                coalesce(t.idf, ln(1 + (greatest(s.total_chunks, 1) - 0.5) / 1.5))
                * p.term_freq * (s.bm25_k1 + 1)
                / (p.term_freq + s.bm25_k1 * (1 - s.bm25_b + s.bm25_b * c.token_count / s.avg_chunk_len))
         FROM knowledge.terms t,
              knowledge.chunks c,
              knowledge.index_stats s
        WHERE p.book_id = $1
          AND t.id = p.term_id
          AND c.id = p.chunk_id
          AND s.avg_chunk_len > 0`,
      [bookId],
    );
  }

  /**
   * Record that a book is waiting in the indexing queue, so the admin UI can
   * show "Queued" instead of "Not indexed". Leaves a book that is indexing
   * right now alone; its job will mark it again when it starts.
   */
  async markQueued(book: {
    bookId: string;
    title?: string;
    author?: string;
  }): Promise<void> {
    await this.pool.query(
      `INSERT INTO knowledge.indexed_books (book_id, title, author, status)
       VALUES ($1, $2, $3, 'pending')
       ON CONFLICT (book_id) DO UPDATE
         SET status = 'pending', error = NULL
       WHERE knowledge.indexed_books.status <> 'indexing'`,
      [book.bookId, book.title ?? null, book.author ?? null],
    );
  }

  async markIndexing(bookId: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO knowledge.indexed_books (book_id, status)
       VALUES ($1, 'indexing')
       ON CONFLICT (book_id) DO UPDATE SET status = 'indexing', error = NULL`,
      [bookId],
    );
  }

  async markFailed(bookId: string, error: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO knowledge.indexed_books (book_id, status, error)
       VALUES ($1, 'failed', $2)
       ON CONFLICT (book_id) DO UPDATE SET status = 'failed', error = EXCLUDED.error`,
      [bookId, error],
    );
  }

  /**
   * Remove a book from the index. Postings go with their chunks (ON DELETE
   * CASCADE); terms.doc_freq/idf stay stale until the next finalize, which
   * dirty_books flags.
   */
  async deleteBook(bookId: string): Promise<number> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const res = await client.query(
        'DELETE FROM knowledge.chunks WHERE book_id = $1',
        [bookId],
      );
      const books = await client.query(
        'DELETE FROM knowledge.indexed_books WHERE book_id = $1',
        [bookId],
      );
      if ((res.rowCount ?? 0) > 0 || (books.rowCount ?? 0) > 0) {
        await client.query(
          'UPDATE knowledge.index_stats SET dirty_books = dirty_books + 1',
        );
      }
      await client.query('COMMIT');
      return res.rowCount ?? 0;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /** Statuses for many books in one query (admin book table). */
  async getBookStatuses(bookIds: string[]): Promise<BookIndexStatus[]> {
    if (bookIds.length === 0) return [];
    const { rows } = await this.pool.query<{
      book_id: string;
      status: BookIndexStatus['status'];
      chunk_count: number;
      token_count: string;
      error: string | null;
      indexed_at: Date | null;
    }>(
      `SELECT book_id, status, chunk_count, token_count, error, indexed_at
         FROM knowledge.indexed_books WHERE book_id = ANY($1::text[])`,
      [bookIds],
    );
    const byId = new Map(rows.map((r) => [r.book_id, r]));
    return bookIds.map((bookId) => {
      const row = byId.get(bookId);
      return row
        ? {
            bookId,
            status: row.status,
            chunkCount: row.chunk_count,
            tokenCount: Number(row.token_count),
            error: row.error,
            indexedAt: row.indexed_at,
          }
        : { bookId, status: 'not_found', chunkCount: 0, tokenCount: 0 };
    });
  }

  async getBookStatus(bookId: string): Promise<BookIndexStatus> {
    const { rows } = await this.pool.query<{
      status: BookIndexStatus['status'];
      chunk_count: number;
      token_count: string;
      error: string | null;
      indexed_at: Date | null;
    }>(
      `SELECT status, chunk_count, token_count, error, indexed_at
         FROM knowledge.indexed_books WHERE book_id = $1`,
      [bookId],
    );
    const row = rows[0];
    if (!row) {
      return { bookId, status: 'not_found', chunkCount: 0, tokenCount: 0 };
    }
    return {
      bookId,
      status: row.status,
      chunkCount: row.chunk_count,
      tokenCount: Number(row.token_count),
      error: row.error,
      indexedAt: row.indexed_at,
    };
  }

  /** Read current corpus statistics including dirty_books since last finalize. */
  async getStats(): Promise<IndexStatsResponse> {
    const { rows } = await this.pool.query<{
      total_chunks: string;
      total_books: number;
      dirty_books: number;
      avg_chunk_len: number;
      updated_at: Date;
      total_terms: string;
    }>(
      // Book/chunk totals are live (indexed_books has one row per book), so
      // they're right between finalizes. avg_chunk_len stays the cached BM25
      // value, which is what ranking uses.
      `SELECT b.total_chunks, b.total_books, s.dirty_books, s.avg_chunk_len, s.updated_at,
              (SELECT count(*) FROM knowledge.terms) AS total_terms
         FROM knowledge.index_stats s,
              (SELECT count(*)::int AS total_books,
                      coalesce(sum(chunk_count), 0) AS total_chunks
                 FROM knowledge.indexed_books
                WHERE status = 'done') b`,
    );
    const s = rows[0];
    return {
      totalChunks: Number(s.total_chunks),
      totalBooks: s.total_books,
      dirtyBooks: s.dirty_books,
      totalTerms: Number(s.total_terms),
      avgChunkLen: s.avg_chunk_len,
      updatedAt: s.updated_at,
    };
  }

  /** Recompute df, IDF, N, avgdl and every posting's BM25 weight; resets dirty_books = 0. */
  async refreshStats(): Promise<IndexStatsResponse> {
    await this.pool.query('SELECT knowledge.refresh_index_stats()');
    return this.getStats();
  }
}
