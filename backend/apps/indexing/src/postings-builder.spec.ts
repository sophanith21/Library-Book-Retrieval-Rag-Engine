import { buildChunkPostings } from './postings-builder';

describe('buildChunkPostings', () => {
  it('groups occurrences by term with parallel positions and offsets', () => {
    const text = 'The whale! A white whale, whaling.';
    const { tokenCount, postings } = buildChunkPostings(text);

    // whale, white, whale, whaling -> 4 indexed tokens; "The" and "A" are stopwords.
    expect(tokenCount).toBe(4);

    const whale = postings.find((p) => p.term === 'whale')!;
    expect(whale.positions).toEqual([1, 4, 5]);
    expect(
      whale.charStarts.map((s, i) => text.slice(s, whale.charEnds[i])),
    ).toEqual(['whale', 'whale', 'whaling']);

    expect(postings.map((p) => p.term).sort()).toEqual(['whale', 'white']);
  });

  it('returns no postings for stopword-only text', () => {
    expect(buildChunkPostings('and the of it')).toEqual({
      tokenCount: 0,
      postings: [],
    });
  });
});
