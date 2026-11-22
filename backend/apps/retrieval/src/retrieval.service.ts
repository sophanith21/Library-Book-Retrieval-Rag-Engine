import { Injectable } from '@nestjs/common';
import { SearchQueryDto, SearchResponse } from '@app/contracts';
import { analyzeQuery } from '@app/text-analysis';
import { Bm25SearchRepository } from './bm25-search.repository';
import { buildSnippet } from './snippet';

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;
const MAX_OFFSET = 1000;
const MAX_QUERY_LENGTH = 500;

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
  constructor(private readonly repo: Bm25SearchRepository) {}

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
}
