import { Injectable } from '@nestjs/common';
import {
  DenseSearchQueryDto,
  DenseSearchResponse,
  SearchQueryDto,
  SearchResponse,
} from '@app/contracts';
import { EmbeddingService } from '@app/embeddings';
import { analyzeQuery } from '@app/text-analysis';
import { Bm25SearchRepository } from './bm25-search.repository';
import { DenseSearchRepository } from './dense-search.repository';
import { buildSnippet } from './snippet';

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;
const MAX_OFFSET = 1000;
const MAX_QUERY_LENGTH = 500;
const DEFAULT_TOP_K_CHUNKS = 20;
const MAX_TOP_K_CHUNKS = 100;

const clampInt = (
  value: unknown,
  fallback: number,
  min: number,
  max: number,
) => {
  const n = Math.trunc(Number(value));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

@Injectable()
export class RetrievalService {
  constructor(
    private readonly repo: Bm25SearchRepository,
    private readonly denseRepo: DenseSearchRepository,
    private readonly embeddings: EmbeddingService,
  ) {}

  async search(dto: SearchQueryDto): Promise<SearchResponse> {
    const startedAt = Date.now();
    const query = String(dto?.query ?? '').slice(0, MAX_QUERY_LENGTH);
    const limit = clampInt(dto?.limit, DEFAULT_LIMIT, 1, MAX_LIMIT);
    const offset = clampInt(dto?.offset, 0, 0, MAX_OFFSET);

    // Same analyzer as the indexer, so query terms match index terms.
    const terms = analyzeQuery(query);
    const empty: SearchResponse = {
      query,
      terms,
      total: 0,
      limit,
      offset,
      tookMs: 0,
      results: [],
    };
    if (terms.length === 0) return { ...empty, tookMs: Date.now() - startedAt };

    const termIds = [...(await this.repo.lookupTerms(terms)).values()];
    if (termIds.length === 0) {
      return { ...empty, tookMs: Date.now() - startedAt };
    }

    const { total, hits } = await this.repo.rankBooks(termIds, limit, offset);
    const spans = await this.repo.termSpans(
      hits.map((h) => h.chunkId),
      termIds,
    );

    return {
      query,
      terms,
      total,
      limit,
      offset,
      tookMs: Date.now() - startedAt,
      results: hits.map((h) => ({
        bookId: h.bookId,
        title: h.title ?? h.bookId,
        author: h.author,
        score: h.score,
        matchedTerms: h.matchedTerms,
        chapterNo: h.chapterNo,
        chunkNo: h.chunkNo,
        snippet: buildSnippet(h.content, spans.get(h.chunkId) ?? []),
      })),
    };
  }

  /**
   * Dense semantic retrieval: encodes the query with the same embedding model
   * (BAAI/bge-small-en-v1.5) and queries the pgvector HNSW cosine index.
   * Returns both deduplicated book results and top-K ranked chunks for RRF/RAG.
   */
  async denseSearch(dto: DenseSearchQueryDto): Promise<DenseSearchResponse> {
    const startedAt = Date.now();
    const query = String(dto?.query ?? '')
      .trim()
      .slice(0, MAX_QUERY_LENGTH);
    const limit = clampInt(dto?.limit, DEFAULT_LIMIT, 1, MAX_LIMIT);
    const offset = clampInt(dto?.offset, 0, 0, MAX_OFFSET);
    const topKChunks = clampInt(
      dto?.topKChunks,
      DEFAULT_TOP_K_CHUNKS,
      1,
      MAX_TOP_K_CHUNKS,
    );

    if (!query) {
      return {
        query,
        model: this.embeddings.model,
        total: 0,
        limit,
        offset,
        tookMs: Date.now() - startedAt,
        results: [],
        topChunks: [],
      };
    }

    const queryEmbedding = await this.embeddings.embedQuery(query);
    const [{ total, hits }, topChunks] = await Promise.all([
      this.denseRepo.rankBooks(queryEmbedding, limit, offset),
      this.denseRepo.rankChunks(queryEmbedding, topKChunks),
    ]);

    return {
      query,
      model: this.embeddings.model,
      total,
      limit,
      offset,
      tookMs: Date.now() - startedAt,
      results: hits.map((h) => ({
        bookId: h.bookId,
        title: h.title ?? h.bookId,
        author: h.author,
        score: h.score,
        chapterNo: h.chapterNo,
        chunkNo: h.chunkNo,
        snippet: buildSnippet(h.content, []),
      })),
      topChunks: topChunks.map((c) => ({
        chunkId: c.chunkId,
        bookId: c.bookId,
        title: c.title ?? c.bookId,
        author: c.author,
        chapterNo: c.chapterNo,
        chunkNo: c.chunkNo,
        content: c.content,
        similarity: c.similarity,
        rank: c.rank,
      })),
    };
  }
}
