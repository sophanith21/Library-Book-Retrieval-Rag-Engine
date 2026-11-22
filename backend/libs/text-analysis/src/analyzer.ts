import { porterStem } from './porter-stemmer';
import { STOPWORDS } from './stopwords';

/**
 * The single source of truth for turning text into index terms.
 *
 * The indexing service runs `analyze()` over chunk text when building
 * postings; the retrieval service runs `analyzeQuery()` over the user's
 * query. If the two ever normalise differently, queries silently stop
 * matching, so both must import from here. Changing anything in this file
 * means the corpus has to be re-indexed.
 */

export interface Token {
  /** Normalised term as stored in knowledge.terms.term */
  term: string;
  /** 0-based word position in the text, stopwords included */
  position: number;
  /** Character offset of the original word in the source text (inclusive) */
  start: number;
  /** Character offset just past the original word (exclusive) */
  end: number;
}

// A word is a run of letters/digits, optionally joined by apostrophes
// (straight or curly, as Standard Ebooks uses ’): "whale’s", "o'clock".
// Hyphens and other punctuation split words: "sea-captain" -> sea, captain.
const WORD_RE = /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu;
const COMBINING_MARKS_RE = /\p{M}+/gu;
const APOSTROPHES_RE = /['’]/g;
const POSSESSIVE_RE = /['’]s$/;
const DIGITS_ONLY_RE = /^\p{N}+$/u;

const MAX_TERM_LENGTH = 64;

/**
 * Normalise one surface word to an index term, or null if it should not be
 * indexed (stopword, too short, too long).
 */
export function normalizeWord(word: string): string | null {
  let w = word
    .toLowerCase()
    .normalize('NFKD')
    .replace(COMBINING_MARKS_RE, '') // café -> cafe, naïve -> naive
    .replace(POSSESSIVE_RE, '') // whale's -> whale
    .replace(APOSTROPHES_RE, ''); // don't -> dont

  if (w.length === 0 || w.length > MAX_TERM_LENGTH) return null;
  if (STOPWORDS.has(w)) return null;
  // Single letters carry no meaning in prose; single digits ("chapter 1") do.
  if (w.length === 1 && !DIGITS_ONLY_RE.test(w)) return null;

  if (!DIGITS_ONLY_RE.test(w)) w = porterStem(w);
  return w;
}

/** Tokenise text into index terms with positions and character offsets. */
export function analyze(text: string): Token[] {
  const tokens: Token[] = [];
  let position = 0;
  for (const match of text.matchAll(WORD_RE)) {
    const term = normalizeWord(match[0]);
    if (term !== null) {
      tokens.push({
        term,
        position,
        start: match.index,
        end: match.index + match[0].length,
      });
    }
    position++;
  }
  return tokens;
}

/** Unique query terms, in first-seen order. */
export function analyzeQuery(query: string): string[] {
  return [...new Set(analyze(query).map((t) => t.term))];
}
