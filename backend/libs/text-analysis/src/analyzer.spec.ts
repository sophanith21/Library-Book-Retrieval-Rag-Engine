import { analyze, analyzeQuery, normalizeWord } from './analyzer';
import { porterStem } from './porter-stemmer';

describe('porterStem', () => {
  // Examples from Porter (1980) and the reference test vocabulary.
  it.each([
    ['caresses', 'caress'],
    ['ponies', 'poni'],
    ['cats', 'cat'],
    ['feed', 'feed'],
    ['agreed', 'agre'],
    ['plastered', 'plaster'],
    ['motoring', 'motor'],
    ['sing', 'sing'],
    ['conflated', 'conflat'],
    ['troubled', 'troubl'],
    ['sized', 'size'],
    ['hopping', 'hop'],
    ['falling', 'fall'],
    ['filing', 'file'],
    ['happy', 'happi'],
    ['relational', 'relat'],
    ['conditional', 'condit'],
    ['digitizer', 'digit'],
    ['triplicate', 'triplic'],
    ['formative', 'form'],
    ['electrical', 'electr'],
    ['revival', 'reviv'],
    ['allowance', 'allow'],
    ['adjustable', 'adjust'],
    ['effective', 'effect'],
    ['adoption', 'adopt'],
    ['generalizations', 'gener'],
    ['oscillators', 'oscil'],
    ['controlling', 'control'],
    ['youth', 'youth'],
    ['as', 'as'],
  ])('%s -> %s', (word, stem) => {
    expect(porterStem(word)).toBe(stem);
  });
});

describe('normalizeWord', () => {
  it('lowercases, strips accents, possessives and apostrophes, then stems', () => {
    expect(normalizeWord('Whales')).toBe('whale');
    expect(normalizeWord('whale’s')).toBe('whale');
    expect(normalizeWord("Captain's")).toBe('captain');
    expect(normalizeWord('Café')).toBe('cafe');
  });

  it('drops stopwords, including contractions', () => {
    expect(normalizeWord('The')).toBeNull();
    expect(normalizeWord('don’t')).toBeNull();
  });

  it('drops single letters but keeps numbers', () => {
    expect(normalizeWord('x')).toBeNull();
    expect(normalizeWord('7')).toBe('7');
    expect(normalizeWord('1851')).toBe('1851');
  });
});

describe('analyze', () => {
  it('returns positions that count stopwords, and offsets into the source', () => {
    const text = 'Call me Ishmael. The white whale’s wake!';
    const tokens = analyze(text);

    expect(tokens.map((t) => t.term)).toEqual([
      'call',
      'ishmael',
      'white',
      'whale',
      'wake',
    ]);
    // "me" (1) and "The" (3) are skipped but still counted.
    expect(tokens.map((t) => t.position)).toEqual([0, 2, 4, 5, 6]);
    for (const t of tokens) {
      expect(normalizeWord(text.slice(t.start, t.end))).toBe(t.term);
    }
    expect(text.slice(tokens[3].start, tokens[3].end)).toBe('whale’s');
  });

  it('splits on hyphens and em-dashes', () => {
    expect(analyze('sea-captain—harpooneer').map((t) => t.term)).toEqual([
      'sea',
      'captain',
      'harpoon',
    ]);
  });
});

describe('analyzeQuery', () => {
  it('normalises like analyze() and de-duplicates', () => {
    expect(analyzeQuery('Whales and whaling: the WHALE')).toEqual(['whale']);
  });
});
