import { strToU8, zipSync } from 'fflate';
import {
  chunkText,
  EpubParseError,
  parseEpub,
  stableBookId,
  xhtmlToText,
} from './epub-parser';

const words = (n: number, word = 'whale') =>
  Array.from({ length: n }, (_, i) => `${word}${i}`).join(' ');

function buildEpub(opts: { epub2Cover?: boolean } = {}): Uint8Array {
  const chapter = (title: string, body: string) =>
    `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>${title}</title>
<style>p { color: red }</style></head>
<body><section><h2>${title}</h2>${body}</section></body></html>`;

  const opf = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Moby Dick; or, The Whale</dc:title>
    <dc:creator id="author">Herman Melville</dc:creator>
    <dc:subject>Sea stories</dc:subject>
    <dc:subject>Whaling &amp; whalers</dc:subject>
    <dc:subject>Sea stories</dc:subject>
    <dc:date>1851-10-18T00:00:00Z</dc:date>
    <dc:description>&lt;p&gt;A sea voyage with &lt;a href="x"&gt;Ahab&lt;/a&gt;, the captain.&lt;/p&gt;&lt;p&gt;Second.&lt;/p&gt;</dc:description>
    ${opts.epub2Cover ? '<meta name="cover" content="img1"/>' : ''}
  </metadata>
  <manifest>
    <item id="titlepage" href="text/title%20page.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch1" href="text/chapter-1.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch2" href="text/chapter-2.xhtml" media-type="application/xhtml+xml"/>
    <item ${opts.epub2Cover ? 'id="img1"' : 'id="c" properties="cover-image"'} href="images/front.jpg" media-type="image/jpeg"/>
  </manifest>
  <spine>
    <itemref idref="titlepage"/>
    <itemref idref="ch1"/>
    <itemref idref="ch1"/>
    <itemref idref="ch2"/>
  </spine>
</package>`;

  return zipSync({
    mimetype: strToU8('application/epub+zip'),
    'META-INF/container.xml': strToU8(
      `<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles>
        <rootfile full-path="epub/content.opf" media-type="application/oebps-package+xml"/>
      </rootfiles></container>`,
    ),
    'epub/content.opf': strToU8(opf),
    'epub/text/title page.xhtml': strToU8(
      chapter('Moby Dick', '<p>By Melville</p>'),
    ),
    'epub/text/chapter-1.xhtml': strToU8(
      chapter(
        'Loomings',
        `<p>Call me <i>Ishmael</i>. Some years ago&#8212;never mind how long.</p>
         <ul><li><p>${words(40)}</p></li></ul>
         <p>${words(120, 'sea')}</p>`,
      ),
    ),
    'epub/text/chapter-2.xhtml': strToU8(
      chapter('The Carpet-Bag', `<p>${words(60, 'bag')}</p>`),
    ),
    'epub/images/front.jpg': new Uint8Array([0xff, 0xd8, 0xff]),
  });
}

describe('parseEpub', () => {
  it('extracts metadata, cover and chapters in spine order', () => {
    const book = parseEpub(buildEpub());

    expect(book.title).toBe('Moby Dick; or, The Whale');
    expect(book.author).toBe('Herman Melville');
    expect(book.categories).toEqual(['Sea stories', 'Whaling & whalers']);
    expect(book.publishedDate).toBe('1851-10-18');
    expect(book.description).toBe(
      'A sea voyage with Ahab, the captain. Second.',
    );
    expect(book.cover).toEqual({
      bytes: new Uint8Array([0xff, 0xd8, 0xff]),
      contentType: 'image/jpeg',
      extension: '.jpg',
    });

    // Title page is too short; ch1 is listed twice in the spine but kept once.
    expect(book.chapters.map((c) => c.chapterNo)).toEqual([1, 2]);
    const [ch1, ch2] = book.chapters;
    expect(ch1.chunks[0]).toMatch(
      /^Loomings\n\nCall me Ishmael\. Some years ago—never/,
    );
    expect(ch1.chunks.join(' ')).not.toContain('color: red');
    expect(ch2.chunks[0]).toContain('bag0');
  });

  it('finds an EPUB 2 cover through <meta name="cover">', () => {
    expect(parseEpub(buildEpub({ epub2Cover: true })).cover?.extension).toBe(
      '.jpg',
    );
  });

  it('rejects files that are not EPUBs', () => {
    expect(() => parseEpub(strToU8('not a zip'))).toThrow(EpubParseError);
    expect(() => parseEpub(zipSync({ 'a.txt': strToU8('x') }))).toThrow(
      /container\.xml/,
    );
  });
});

describe('xhtmlToText', () => {
  it('turns block elements into paragraphs without duplicating nested text', () => {
    expect(
      xhtmlToText(
        '<body><ul><li><p>one <b>two</b></p></li></ul><p>a&amp;b<br/>c</p></body>',
      ),
    ).toBe('one two\n\na&b c');
  });
});

describe('chunkText', () => {
  it('packs paragraphs up to the word limit with paragraph overlap', () => {
    const p = (n: number, w: string) => words(n, w);
    const text = [p(60, 'a'), p(60, 'b'), p(20, 'c'), p(60, 'd')].join('\n\n');
    const chunks = chunkText(text, 150, 30);

    expect(chunks).toHaveLength(2);
    expect(chunks[0].split('\n\n')).toHaveLength(3); // a, b, c = 140 words
    // c (20 words) fits in the 30-word overlap and starts the next chunk.
    expect(chunks[1].startsWith('c0')).toBe(true);
    expect(chunks[1]).toContain('d59');
  });

  it('splits an oversized paragraph on sentences, then on words', () => {
    const sentences = `${words(100, 'x')}. ${words(100, 'y')}.`;
    expect(chunkText(sentences, 150, 0)).toHaveLength(2);
    expect(chunkText(words(400), 150, 0)).toHaveLength(3);
  });
});

describe('stableBookId', () => {
  it('matches bootstrap.py make_stable_book_id', () => {
    expect(stableBookId('herman-melville_moby-dick.epub')).toBe(
      'book-herman-melville-moby-dick',
    );
    expect(stableBookId('C:\\books\\Moby Dick!.epub')).toBe('book-moby-dick');
    const long = `${'a'.repeat(60)}.epub`;
    expect(stableBookId(long)).toMatch(/^book-a{39}-[0-9a-f]{8}$/);
  });
});
