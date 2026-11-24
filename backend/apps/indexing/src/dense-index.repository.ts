import { Inject, Injectable } from '@nestjs/common';
import { KNOWLEDGE_POOL } from '@app/knowledge-db';
import { toPgVectorSql } from '@app/embeddings';
import { Pool } from 'pg';

export interface UnembeddedChunk {
  chunkId: string;
  content: string;
}

export interface ChunkEmbeddingUpdate {
  chunkId: string;
  embedding: number[];
}

const EMBEDDING_UPDATE_BATCH = 200;

@Injectable()
export class DenseIndexRepository {
  constructor(@Inject(KNOWLEDGE_POOL) private readonly pool: Pool) {}

  /** Fetch chunks whose embedding column is still NULL. */
  async findChunksWithoutEmbeddings(
    bookId?: string,
    limit = 500,
  ): Promise<UnembeddedChunk[]> {
    const { rows } = bookId
      ? await this.pool.query<{ id: string; content: string }>(
          `SELECT id, content
             FROM knowledge.chunks
            WHERE book_id = $1
              AND embedding IS NULL
            ORDER BY id
            LIMIT $2`,
          [bookId, limit],
        )
      : await this.pool.query<{ id: string; content: string }>(
          `SELECT id, content
             FROM knowledge.chunks
            WHERE embedding IS NULL
            ORDER BY id
            LIMIT $1`,
          [limit],
        );

    return rows.map((r) => ({ chunkId: r.id, content: r.content }));
  }

  /** Persist vector embeddings into knowledge.chunks.embedding in batches. */
  async updateChunkEmbeddings(
    entries: ChunkEmbeddingUpdate[],
  ): Promise<number> {
    if (entries.length === 0) return 0;

    let updated = 0;
    for (let i = 0; i < entries.length; i += EMBEDDING_UPDATE_BATCH) {
      const batch = entries.slice(i, i + EMBEDDING_UPDATE_BATCH);
      const ids = batch.map((e) => e.chunkId);
      const vectors = batch.map((e) => toPgVectorSql(e.embedding));

      const res = await this.pool.query(
        `UPDATE knowledge.chunks AS c
            SET embedding = u.vec::vector
           FROM unnest($1::bigint[], $2::text[]) AS u(id, vec)
          WHERE c.id = u.id`,
        [ids, vectors],
      );
      updated += res.rowCount ?? batch.length;
    }
    return updated;
  }

  /** Count how many chunks still have NULL embeddings. */
  async countMissingEmbeddings(bookId?: string): Promise<number> {
    const { rows } = bookId
      ? await this.pool.query<{ count: string }>(
          `SELECT count(*) AS count
             FROM knowledge.chunks
            WHERE book_id = $1 AND embedding IS NULL`,
          [bookId],
        )
      : await this.pool.query<{ count: string }>(
          `SELECT count(*) AS count
             FROM knowledge.chunks
            WHERE embedding IS NULL`,
        );
    return Number(rows[0]?.count ?? 0);
  }
}
