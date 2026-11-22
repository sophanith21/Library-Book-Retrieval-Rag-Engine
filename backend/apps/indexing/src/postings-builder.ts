import { analyze } from '@app/text-analysis';

/** All occurrences of one term within one chunk — one row of knowledge.postings. */
export interface ChunkPosting {
  term: string;
  positions: number[];
  charStarts: number[];
  charEnds: number[];
}

export interface AnalyzedChunk {
  /** Number of indexed tokens (stopwords excluded) — BM25 document length |d| */
  tokenCount: number;
  postings: ChunkPosting[];
}

/**
 * Turn one chunk's text into its postings: group the analyzer's tokens by
 * term, keeping every occurrence's position and character offsets.
 */
export function buildChunkPostings(content: string): AnalyzedChunk {
  const tokens = analyze(content);
  const byTerm = new Map<string, ChunkPosting>();

  for (const token of tokens) {
    let posting = byTerm.get(token.term);
    if (!posting) {
      posting = {
        term: token.term,
        positions: [],
        charStarts: [],
        charEnds: [],
      };
      byTerm.set(token.term, posting);
    }
    posting.positions.push(token.position);
    posting.charStarts.push(token.start);
    posting.charEnds.push(token.end);
  }

  return { tokenCount: tokens.length, postings: [...byTerm.values()] };
}
