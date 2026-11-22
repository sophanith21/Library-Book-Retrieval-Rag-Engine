import { analyze } from '@app/text-analysis';
import { buildSnippet, TermSpan } from './snippet';

/** Spans for the given query terms, computed the same way the indexer does. */
function spansFor(content: string, terms: string[]): TermSpan[] {
  return analyze(content)
    .filter((t) => terms.includes(t.term))
    .map((t) => ({ start: t.start, end: t.end, term: t.term }));
}

/** Render highlights as [[..]] to make assertions readable. */
function render(snippet: {
  text: string;
  highlights: { start: number; end: number }[];
}) {
  let out = snippet.text;
  for (const h of [...snippet.highlights].reverse()) {
    out =
      out.slice(0, h.start) +
      '[[' +
      out.slice(h.start, h.end) +
      ']]' +
      out.slice(h.end);
  }
  return out;
}

const filler = (n: number, word: string) => Array(n).fill(word).join(' ');

describe('buildSnippet', () => {
  it('returns short content whole, with highlights', () => {
    const content = 'The white whale’s wake was wide.';
    const snippet = buildSnippet(
      content,
      spansFor(content, ['white', 'whale']),
    );
    expect(render(snippet)).toBe('The [[white]] [[whale’s]] wake was wide.');
  });

  it('prefers the window covering more distinct query terms', () => {
    const content =
      `A whale appeared. ${filler(60, 'lorem')} ` +
      `Then the white whale surfaced. ${filler(60, 'ipsum')}`;
    const snippet = buildSnippet(
      content,
      spansFor(content, ['white', 'whale']),
      120,
    );

    expect(render(snippet)).toContain('[[white]] [[whale]] surfaced');
    expect(render(snippet)).not.toContain('appeared');
    expect(snippet.text.startsWith('…')).toBe(true);
    expect(snippet.text.endsWith('…')).toBe(true);
    expect(snippet.text.length).toBeLessThanOrEqual(122); // maxLength + 2 ellipses
  });

  it('cuts at word boundaries', () => {
    const content = `${filler(40, 'alphabet')} needle ${filler(40, 'zeppelin')}`;
    const { text } = buildSnippet(content, spansFor(content, ['needl']), 100);
    const inner = text.replace(/^…|…$/g, '');
    for (const word of inner.split(' ')) {
      expect(['alphabet', 'needle', 'zeppelin']).toContain(word);
    }
  });

  it('highlight ranges point at the matched words in the snippet text', () => {
    const content = `${filler(50, 'sea')} Ishmael met Queequeg. ${filler(50, 'sea')}`;
    const snippet = buildSnippet(
      content,
      spansFor(content, ['ishmael', 'queequeg']),
      80,
    );
    expect(
      snippet.highlights.map((h) => snippet.text.slice(h.start, h.end)),
    ).toEqual(['Ishmael', 'Queequeg']);
  });

  it('falls back to the start of the chunk when there are no hits', () => {
    const content = filler(100, 'word');
    const snippet = buildSnippet(content, [], 50);
    expect(snippet.highlights).toEqual([]);
    expect(snippet.text.startsWith('word')).toBe(true);
    expect(snippet.text.endsWith('…')).toBe(true);
  });
});
