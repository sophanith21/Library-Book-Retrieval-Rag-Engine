import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import { strFromU8, unzipSync } from 'fflate';
import { ChapterItem } from '@app/contracts';

/**
 * Server-side EPUB parsing for admin uploads.
 *
 * Mirrors the Python ingestion scripts so books look the same whichever way
 * they enter the system:
 *   - book ids follow bootstrap.py's make_stable_book_id()
 *   - chapters follow the OPF spine (reading order)
 *   - text is split into block-level paragraphs and packed into ~150-word
 *     chunks with a ~30-word paragraph overlap, as in ingest2.py
 */

export const MAX_CHUNK_WORDS = 150;
export const OVERLAP_WORDS = 30;
/** Spine documents with less text than this (characters) are front matter. */
const MIN_CHAPTER_CHARS = 100;

export class EpubParseError extends Error {}

export interface ParsedEpub {
  title: string;
  author: string;
  categories: string[];
  publishedDate: string | null;
  description: string | null;
  cover: { bytes: Uint8Array; contentType: string; extension: string } | null;
  chapters: ChapterItem[];
}

interface ManifestItem {
  id: string;
  href: string;
  mediaType: string;
  properties: string;
}

// ---------------------------------------------------------------------------
// Book id
// ---------------------------------------------------------------------------

/** Port of bootstrap.py make_stable_book_id(). */
export function stableBookId(filename: string): string {
  const base = posix.basename(filename.replace(/\\/g, '/'));
  const stem = base.replace(/\.[^.]*$/, '');
  const slug = stem
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (slug.length <= 48) return `book-${slug || 'untitled'}`;
  const digest = createHash('sha1')
    .update(base, 'utf8')
    .digest('hex')
    .slice(0, 8);
  return `book-${slug.slice(0, 39)}-${digest}`;
}

// ---------------------------------------------------------------------------
// Tiny XML/HTML helpers (EPUB metadata is regular enough not to need a DOM)
// ---------------------------------------------------------------------------

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  mdash: '—',
  ndash: '–',
  hellip: '…',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  copy: '©',
  shy: '',
};

export function decodeEntities(text: string): string {
  return text.replace(
    /&(#x[0-9a-f]+|#\d+|[a-z]+);/gi,
    (match, body: string) => {
      if (body[0] === '#') {
        const code =
          body[1] === 'x' || body[1] === 'X'
            ? parseInt(body.slice(2), 16)
            : parseInt(body.slice(1), 10);
        return Number.isFinite(code) && code > 0 && code <= 0x10ffff
          ? String.fromCodePoint(code)
          : match;
      }
      return NAMED_ENTITIES[body.toLowerCase()] ?? match;
    },
  );
}

function attributes(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const m of tag.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    attrs[m[1].toLowerCase()] = decodeEntities(m[2] ?? m[3] ?? '');
  }
  return attrs;
}

/** Text content of every <prefix:name> element (namespace prefix optional). */
function elementTexts(xml: string, name: string): string[] {
  const re = new RegExp(
    `<(?:[\\w-]+:)?${name}\\b[^>]*>([\\s\\S]*?)</(?:[\\w-]+:)?${name}>`,
    'gi',
  );
  // Block tags separate words; inline tags (<a>, <i>) must not, or
  // "<a>Lindbergh</a>, the" becomes "Lindbergh , the".
  const stripTags = (s: string) =>
    s
      .replace(new RegExp(`</?(?:${BLOCK_TAGS}|br)\\b[^>]*>`, 'gi'), ' ')
      .replace(/<[^>]+>/g, '');
  // Strip twice: descriptions often hold entity-escaped HTML ("&lt;p&gt;").
  return [...xml.matchAll(re)]
    .map((m) => collapse(stripTags(decodeEntities(stripTags(m[1])))))
    .filter(Boolean);
}

const collapse = (text: string) => text.replace(/\s+/g, ' ').trim();

const BLOCK_TAGS =
  'h1|h2|h3|h4|h5|h6|p|li|blockquote|td|th|pre|figcaption|div|section|article|header|footer|tr|dt|dd|hr|aside';

/**
 * XHTML document -> paragraphs separated by blank lines. Block-level tags
 * become paragraph boundaries and inline tags are dropped, so text nested in
 * several blocks (<li><p>) appears exactly once.
 */
export function xhtmlToText(xhtml: string): string {
  const body = /<body\b[^>]*>([\s\S]*)<\/body>/i.exec(xhtml)?.[1] ?? xhtml;
  const text = body
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|nav|head)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(new RegExp(`</?(?:${BLOCK_TAGS})\\b[^>]*>`, 'gi'), '\n\n')
    .replace(/<br\b[^>]*>/gi, ' ')
    .replace(/<[^>]+>/g, '');
  return decodeEntities(text)
    .split(/\n\s*\n/)
    .map(collapse)
    .filter(Boolean)
    .join('\n\n');
}

// ---------------------------------------------------------------------------
// Chunking (port of ingest2.py chunk_text)
// ---------------------------------------------------------------------------

const wordCount = (text: string) => text.split(/\s+/).filter(Boolean).length;

function splitLongParagraph(paragraph: string, maxWords: number): string[] {
  const pieces: string[] = [];
  let current: string[] = [];
  let count = 0;
  for (const sentence of paragraph.split(/(?<=[.!?])\s+/)) {
    const n = wordCount(sentence);
    if (current.length > 0 && count + n > maxWords) {
      pieces.push(current.join(' '));
      current = [];
      count = 0;
    }
    current.push(sentence);
    count += n;
  }
  if (current.length > 0) pieces.push(current.join(' '));
  // A single "sentence" longer than maxWords (no punctuation) is cut by words.
  return pieces.flatMap((piece) => {
    const words = piece.split(/\s+/).filter(Boolean);
    if (words.length <= maxWords) return [piece];
    const out: string[] = [];
    for (let i = 0; i < words.length; i += maxWords) {
      out.push(words.slice(i, i + maxWords).join(' '));
    }
    return out;
  });
}

export function chunkText(
  text: string,
  maxWords = MAX_CHUNK_WORDS,
  overlapWords = OVERLAP_WORDS,
): string[] {
  const paragraphs: string[] = [];
  for (const raw of text.split('\n\n')) {
    const p = raw.trim();
    if (!p) continue;
    if (wordCount(p) > maxWords)
      paragraphs.push(...splitLongParagraph(p, maxWords));
    else paragraphs.push(p);
  }

  const chunks: string[] = [];
  let current: string[] = [];
  let count = 0;
  for (const p of paragraphs) {
    const n = wordCount(p);
    if (current.length > 0 && count + n > maxWords) {
      chunks.push(current.join('\n\n'));
      // Carry the trailing paragraphs into the next chunk as overlap.
      const carry: string[] = [];
      let carryCount = 0;
      for (let i = current.length - 1; i >= 0; i--) {
        const w = wordCount(current[i]);
        if (carryCount + w > overlapWords) break;
        carry.unshift(current[i]);
        carryCount += w;
      }
      current = carry;
      count = carryCount;
    }
    current.push(p);
    count += n;
  }
  if (current.length > 0) chunks.push(current.join('\n\n'));
  return chunks;
}

// ---------------------------------------------------------------------------
// EPUB
// ---------------------------------------------------------------------------

const IMAGE_EXTENSIONS: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
};

function resolveHref(opfDir: string, href: string): string {
  let decoded = href.split('#')[0];
  try {
    decoded = decodeURIComponent(decoded);
  } catch {
    /* keep the raw href */
  }
  return posix.normalize(opfDir ? `${opfDir}/${decoded}` : decoded);
}

function findCover(
  opf: string,
  manifest: ManifestItem[],
): ManifestItem | undefined {
  const images = manifest.filter((i) => i.mediaType.startsWith('image/'));
  // EPUB 3: <item properties="cover-image">
  const epub3 = images.find((i) =>
    i.properties.split(/\s+/).includes('cover-image'),
  );
  if (epub3) return epub3;
  // EPUB 2: <meta name="cover" content="item-id"/>
  for (const m of opf.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = attributes(m[0]);
    if (attrs.name === 'cover' && attrs.content) {
      const item = images.find((i) => i.id === attrs.content);
      if (item) return item;
    }
  }
  return images.find((i) => /cover/i.test(i.id) || /cover/i.test(i.href));
}

export function parseEpub(data: Uint8Array): ParsedEpub {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(data);
  } catch {
    throw new EpubParseError('File is not a valid EPUB (zip) archive');
  }
  const read = (path: string) => {
    const bytes = files[path];
    return bytes ? strFromU8(bytes) : undefined;
  };

  const container = read('META-INF/container.xml');
  if (!container) throw new EpubParseError('Missing META-INF/container.xml');
  const rootfile = /<rootfile\b[^>]*>/i.exec(container);
  const opfPath = rootfile ? attributes(rootfile[0])['full-path'] : undefined;
  const opf = opfPath ? read(opfPath) : undefined;
  if (!opfPath || !opf)
    throw new EpubParseError('Missing OPF package document');
  const opfDir = posix.dirname(opfPath) === '.' ? '' : posix.dirname(opfPath);

  const manifest: ManifestItem[] = [...opf.matchAll(/<item\b[^>]*>/gi)].map(
    (m) => {
      const a = attributes(m[0]);
      return {
        id: a.id ?? '',
        href: a.href ?? '',
        mediaType: (a['media-type'] ?? '').toLowerCase(),
        properties: a.properties ?? '',
      };
    },
  );
  const byId = new Map(manifest.map((item) => [item.id, item]));

  const title = elementTexts(opf, 'title')[0] ?? 'Untitled';
  const author = elementTexts(opf, 'creator')[0] ?? 'Unknown';
  const categories = [...new Set(elementTexts(opf, 'subject'))];
  // Usually the ebook edition's release timestamp; keep just the date part.
  const rawDate = elementTexts(opf, 'date')[0];
  const publishedDate = rawDate
    ? (/^\d{4}(-\d{2}(-\d{2})?)?/.exec(rawDate)?.[0] ?? rawDate)
    : null;
  const description = elementTexts(opf, 'description')[0] ?? null;

  let cover: ParsedEpub['cover'] = null;
  const coverItem = findCover(opf, manifest);
  if (coverItem) {
    const bytes = files[resolveHref(opfDir, coverItem.href)];
    if (bytes) {
      cover = {
        bytes,
        contentType: coverItem.mediaType,
        extension: IMAGE_EXTENSIONS[coverItem.mediaType] ?? '.img',
      };
    }
  }

  const chapters: ChapterItem[] = [];
  const seen = new Set<string>();
  for (const m of opf.matchAll(/<itemref\b[^>]*>/gi)) {
    const idref = attributes(m[0]).idref;
    if (!idref || seen.has(idref)) continue;
    seen.add(idref);
    const item = byId.get(idref);
    if (!item || !/x?html/.test(item.mediaType)) continue;
    const xhtml = read(resolveHref(opfDir, item.href));
    if (!xhtml) continue;
    const text = xhtmlToText(xhtml);
    if (text.length < MIN_CHAPTER_CHARS) continue;
    const chunks = chunkText(text);
    if (chunks.length > 0) {
      chapters.push({ chapterNo: chapters.length + 1, chunks });
    }
  }

  return {
    title,
    author,
    categories,
    publishedDate,
    description,
    cover,
    chapters,
  };
}
