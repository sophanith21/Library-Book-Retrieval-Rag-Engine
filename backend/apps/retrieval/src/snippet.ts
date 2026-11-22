import { HighlightSpan, Snippet } from '@app/contracts';

/** One occurrence of a query term in the chunk, from knowledge.postings offsets. */
export interface TermSpan {
  start: number;
  end: number;
  term: string;
}

export const DEFAULT_SNIPPET_LENGTH = 220;
const ELLIPSIS = '…';
const isSpace = (ch: string | undefined) => ch !== undefined && /\s/.test(ch);

/**
 * Cut a Google-style preview out of a chunk:
 *  1. choose the window (<= maxLength chars) covering the most distinct query
 *     terms, then the most hits, preferring earlier windows on ties;
 *  2. put roughly a third of the leftover room before the first hit as lead-in
 *     context;
 *  3. snap both ends to word boundaries and add ellipses where text was cut;
 *  4. return highlight ranges relative to the snippet text.
 *
 * Offsets come pre-computed from the index, so nothing is re-tokenised here.
 */
export function buildSnippet(
  content: string,
  spans: TermSpan[],
  maxLength = DEFAULT_SNIPPET_LENGTH,
): Snippet {
  const hits = [...spans]
    .filter((s) => s.start >= 0 && s.end <= content.length && s.start < s.end)
    .sort((a, b) => a.start - b.start || a.end - b.end);

  let start: number;
  let end: number;
  let coverStart: number;
  let coverEnd: number;

  if (hits.length === 0) {
    start = 0;
    end = Math.min(content.length, maxLength);
    coverStart = coverEnd = 0;
  } else {
    // 1. Best window of hits [bestI, bestJ)
    let bestI = 0;
    let bestJ = 1;
    let bestDistinct = 0;
    let bestCount = 0;
    for (let i = 0; i < hits.length; i++) {
      const terms = new Set<string>();
      let j = i;
      while (
        j < hits.length &&
        (j === i || hits[j].end - hits[i].start <= maxLength)
      ) {
        terms.add(hits[j].term);
        j++;
      }
      const count = j - i;
      if (
        terms.size > bestDistinct ||
        (terms.size === bestDistinct && count > bestCount)
      ) {
        bestI = i;
        bestJ = j;
        bestDistinct = terms.size;
        bestCount = count;
      }
    }

    coverStart = hits[bestI].start;
    coverEnd = hits[bestJ - 1].end;

    // 2. Spend the spare room: a third before the hits, the rest after.
    const slack = Math.max(0, maxLength - (coverEnd - coverStart));
    start = Math.max(0, coverStart - Math.floor(slack / 3));
    end = Math.min(
      content.length,
      start + Math.max(maxLength, coverEnd - start),
    );
    if (end - start < maxLength) start = Math.max(0, end - maxLength);
  }

  // 3. Snap to word boundaries without cutting into the highlighted region.
  if (start > 0 && !isSpace(content[start - 1])) {
    while (start < coverStart && !isSpace(content[start])) start++;
  }
  while (start < coverStart && isSpace(content[start])) start++;

  if (end < content.length && !isSpace(content[end])) {
    let e = end;
    while (e > coverEnd && !isSpace(content[e - 1])) e--;
    if (e > coverEnd || isSpace(content[e - 1])) end = e;
  }
  while (end > Math.max(start, coverEnd) && isSpace(content[end - 1])) end--;

  const prefix = start > 0 ? ELLIPSIS : '';
  const suffix = end < content.length ? ELLIPSIS : '';
  const text = prefix + content.slice(start, end) + suffix;

  // 4. Highlights relative to the snippet text.
  const highlights: HighlightSpan[] = hits
    .filter((h) => h.start >= start && h.end <= end)
    .map((h) => ({
      start: h.start - start + prefix.length,
      end: h.end - start + prefix.length,
    }));

  return { text, highlights };
}
