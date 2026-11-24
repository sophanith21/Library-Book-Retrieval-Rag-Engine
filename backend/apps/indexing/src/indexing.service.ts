import { Injectable, Logger } from '@nestjs/common';
import {
  BookIndexStatus,
  EmbedBookDto,
  EmbedBookResponse,
  IndexStatsResponse,
  ProcessBookIndexDto,
} from '@app/contracts';
import { EmbeddingService } from '@app/embeddings';
import { DenseIndexRepository } from './dense-index.repository';
import {
  ChunkToIndex,
  InvertedIndexRepository,
} from './inverted-index.repository';
import { buildChunkPostings } from './postings-builder';

@Injectable()
export class IndexingService {
  private readonly logger = new Logger(IndexingService.name);

  constructor(
    private readonly repo: InvertedIndexRepository,
    private readonly denseRepo: DenseIndexRepository,
    private readonly embeddings: EmbeddingService,
  ) {}

  /**
   * Build and store the inverted index for one book. Failures are recorded
   * in knowledge.indexed_books rather than thrown, so one malformed EPUB
   * doesn't stall the queue.
   */
  async indexBook(dto: ProcessBookIndexDto): Promise<BookIndexStatus> {
    const bookId = dto?.bookId;
    if (!bookId) {
      this.logger.warn('Dropping processBook message without a bookId');
      return { bookId: '', status: 'not_found', chunkCount: 0, tokenCount: 0 };
    }

    const startedAt = Date.now();
    try {
      await this.repo.markIndexing(bookId);
      const chunks = this.analyzeBook(dto);
      if (chunks.length === 0) {
        throw new Error('Book has no non-empty chunks');
      }
      await this.repo.replaceBook(dto, chunks);

      // Append dense vector embeddings for the newly indexed book chunks.
      // Failures here are logged without failing sparse indexing so embeddings
      // can be backfilled later via indexing.embedBook.
      if (this.embeddings.isEnabled()) {
        try {
          await this.embedBook({ bookId });
        } catch (embedErr) {
          const embedMsg =
            embedErr instanceof Error ? embedErr.message : String(embedErr);
          this.logger.warn(
            `Dense embedding for ${bookId} skipped (can backfill later): ${embedMsg}`,
          );
        }
      }

      const status = await this.repo.getBookStatus(bookId);
      this.logger.log(
        `Indexed ${bookId}: ${status.chunkCount} chunks, ` +
          `${status.tokenCount} tokens in ${Date.now() - startedAt} ms`,
      );
      return status;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Indexing ${bookId} failed: ${message}`);
      await this.repo.markFailed(bookId, message);
      return this.repo.getBookStatus(bookId);
    }
  }

  private analyzeBook(dto: ProcessBookIndexDto): ChunkToIndex[] {
    if (!Array.isArray(dto.chapters)) {
      throw new Error('chapters must be an array');
    }
    const chunks: ChunkToIndex[] = [];
    for (const chapter of dto.chapters) {
      if (!Number.isInteger(chapter?.chapterNo)) {
        throw new Error('every chapter needs an integer chapterNo');
      }
      (chapter.chunks ?? []).forEach((content, i) => {
        if (typeof content !== 'string' || content.trim() === '') return;
        chunks.push({
          chapterNo: chapter.chapterNo,
          chunkNo: i + 1,
          content,
          ...buildChunkPostings(content),
        });
      });
    }
    return chunks;
  }

  getStatus(bookId: string): Promise<BookIndexStatus> {
    return this.repo.getBookStatus(bookId);
  }

  /** Run after a bulk load so BM25 weights reflect the whole corpus. */
  async finalize(): Promise<IndexStatsResponse> {
    const startedAt = Date.now();
    const stats = await this.repo.refreshStats();
    this.logger.log(
      `Refreshed index stats in ${Date.now() - startedAt} ms: ` +
        `${stats.totalBooks} books, ${stats.totalChunks} chunks, ${stats.totalTerms} terms`,
    );
    return stats;
  }

  /**
   * Generate and store dense vector embeddings (pgvector) for chunks that do
   * not yet have one. Works per-book or as a global backfill when bookId is omitted.
   */
  async embedBook(dto?: EmbedBookDto): Promise<EmbedBookResponse> {
    const startedAt = Date.now();
    const bookId = dto?.bookId;
    const limit = dto?.limit ?? (bookId ? 10_000 : 500);

    const pending = await this.denseRepo.findChunksWithoutEmbeddings(
      bookId,
      limit,
    );

    let embeddedChunks = 0;
    if (pending.length > 0) {
      const vectors = await this.embeddings.embedDocuments(
        pending.map((c) => c.content),
      );
      embeddedChunks = await this.denseRepo.updateChunkEmbeddings(
        pending.map((c, i) => ({
          chunkId: c.chunkId,
          embedding: vectors[i],
        })),
      );
    }

    const remainingChunks = await this.denseRepo.countMissingEmbeddings(bookId);
    const tookMs = Date.now() - startedAt;

    this.logger.log(
      `Dense embedded ${embeddedChunks} chunks` +
        (bookId ? ` for ${bookId}` : '') +
        ` (${remainingChunks} remaining) in ${tookMs} ms`,
    );

    return {
      bookId,
      model: this.embeddings.model,
      dimensions: this.embeddings.dimensions,
      embeddedChunks,
      remainingChunks,
      tookMs,
    };
  }
}
