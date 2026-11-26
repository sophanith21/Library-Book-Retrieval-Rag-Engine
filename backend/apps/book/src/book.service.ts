import { Inject, Injectable, Logger } from '@nestjs/common';
import { ClientProxy, RpcException } from '@nestjs/microservices';
import {
  BookFileUrlResponse,
  BookItem,
  BookListResponse,
  CategoryCount,
  CreateBookDto,
  DeleteBookResponse,
  ListBooksQueryDto,
  PATTERNS,
  ProcessBookIndexDto,
  SERVICES,
  UpdateBookDto,
  UploadBookMessage,
  UploadBookResponse,
} from '@app/contracts';
import { PrismaService } from '@app/prisma';
import { firstValueFrom } from 'rxjs';
import {
  EpubParseError,
  parseEpub,
  ParsedEpub,
  stableBookId,
} from './epub/epub-parser';
import { ObjectStorageService } from './storage/object-storage.service';

const DEFAULT_LIMIT = 24;
const MAX_LIMIT = 100;
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
const MAX_TEXT_FIELD = 500;
const MAX_DESCRIPTION = 5000;

interface BookRow {
  id: string;
  title: string;
  author: string;
  categories: string[];
  publishedDate: string | null;
  description: string | null;
  coverUrl: string | null;
  fileKey: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export function bookError(statusCode: number, message: string): RpcException {
  return new RpcException({ statusCode, message });
}

const clampInt = (
  value: unknown,
  fallback: number,
  min: number,
  max: number,
) => {
  const n = Math.trunc(Number(value));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

const cleanText = (
  value: unknown,
  max = MAX_TEXT_FIELD,
): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim().slice(0, max);
  return trimmed || undefined;
};

const cleanCategories = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const names = value
    .map((v) => cleanText(v, 100))
    .filter((v): v is string => v !== undefined);
  return [...new Set(names)].slice(0, 30);
};

/** Optional nullable text: undefined = leave as is, '' / null = clear. */
const nullableText = (value: unknown, max = MAX_TEXT_FIELD) =>
  value === null || value === '' ? null : cleanText(value, max);

@Injectable()
export class BookService {
  private readonly logger = new Logger(BookService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: ObjectStorageService,
    @Inject(SERVICES.INDEXING) private readonly indexing: ClientProxy,
  ) {}

  // -------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------

  async findAll(dto: ListBooksQueryDto = {}): Promise<BookListResponse> {
    const limit = clampInt(dto.limit, DEFAULT_LIMIT, 1, MAX_LIMIT);
    const offset = clampInt(dto.offset, 0, 0, 100_000);
    const q = cleanText(dto.q, 200);
    const category = cleanText(dto.category, 100);

    const where = {
      ...(q && {
        OR: [
          { title: { contains: q, mode: 'insensitive' as const } },
          { author: { contains: q, mode: 'insensitive' as const } },
        ],
      }),
      ...(category && { categories: { has: category } }),
    };
    const orderBy =
      dto.sort === 'newest'
        ? [{ createdAt: 'desc' as const }, { id: 'asc' as const }]
        : dto.sort === 'author'
          ? [{ author: 'asc' as const }, { title: 'asc' as const }]
          : [{ title: 'asc' as const }, { id: 'asc' as const }];

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.book.count({ where }),
      this.prisma.book.findMany({ where, orderBy, skip: offset, take: limit }),
    ]);
    return { total, limit, offset, items: rows.map((r) => this.toItem(r)) };
  }

  async findById(id: string): Promise<BookItem> {
    return this.toItem(await this.getRow(id));
  }

  async categories(): Promise<CategoryCount[]> {
    const rows = await this.prisma.$queryRaw<{ name: string; count: bigint }[]>`
      SELECT c AS name, count(*) AS count
        FROM book.books, unnest(categories) AS c
       GROUP BY c
       ORDER BY count(*) DESC, c
       LIMIT 100`;
    return rows.map((r) => ({ name: r.name, count: Number(r.count) }));
  }

  async getFileUrl(id: string): Promise<BookFileUrlResponse> {
    const row = await this.getRow(id);
    const key = this.storage.keyFor(row.fileKey);
    if (!key) throw bookError(404, 'No EPUB file is stored for this book');
    const filename = `${row.title.replace(/[^\w\s.,'()-]+/g, '').trim() || row.id}.epub`;
    const { url, expiresIn } = this.storage.presignedUrl(key, {
      downloadAs: filename,
    });
    return { url, expiresIn, filename };
  }

  // -------------------------------------------------------------------------
  // Commands
  // -------------------------------------------------------------------------

  /** Create or update metadata (idempotent on id, like the ingestion scripts). */
  async create(dto: CreateBookDto): Promise<BookItem> {
    const title = cleanText(dto?.title);
    if (!title) throw bookError(400, 'title is required');
    const id = cleanText(dto.id, 200) ?? stableBookId(title);
    if (!/^[\w.-]+$/.test(id)) {
      throw bookError(
        400,
        'id may only contain letters, digits, ".", "_" and "-"',
      );
    }
    const data = {
      title,
      author: cleanText(dto.author) ?? 'Unknown',
      categories: cleanCategories(dto.categories ?? dto.category) ?? [],
      publishedDate: nullableText(dto.publishedDate ?? dto.date, 100) ?? null,
      description: nullableText(dto.description, MAX_DESCRIPTION) ?? null,
      coverUrl: nullableText(dto.coverUrl, 2000) ?? null,
      fileKey: nullableText(dto.fileKey, 1000) ?? null,
    };
    const row = await this.prisma.book.upsert({
      where: { id },
      create: { id, ...data },
      update: data,
    });
    return this.toItem(row);
  }

  async update(id: string, patch: UpdateBookDto = {}): Promise<BookItem> {
    await this.getRow(id);
    const title =
      patch.title === undefined ? undefined : cleanText(patch.title);
    if (patch.title !== undefined && !title) {
      throw bookError(400, 'title cannot be empty');
    }
    const row = await this.prisma.book.update({
      where: { id },
      data: {
        title,
        author:
          patch.author === undefined
            ? undefined
            : (cleanText(patch.author) ?? 'Unknown'),
        categories: cleanCategories(patch.categories),
        publishedDate: nullableText(patch.publishedDate, 100),
        description: nullableText(patch.description, MAX_DESCRIPTION),
      },
    });
    return this.toItem(row);
  }

  /** Remove the book, its stored files, and its search index entries. */
  async delete(id: string): Promise<DeleteBookResponse> {
    const row = await this.getRow(id);
    await this.prisma.book.delete({ where: { id } });

    for (const ref of [row.fileKey, row.coverUrl]) {
      const key = this.storage.keyFor(ref);
      if (key) await this.storage.delete(key);
    }
    await this.emitIndexing(PATTERNS.INDEXING.DELETE_BOOK, { bookId: id });
    return { id, deleted: true };
  }

  /**
   * Admin upload: store the EPUB and cover, register the book, and queue it
   * for indexing (sparse BM25 + dense embeddings run in the indexing service).
   */
  async upload(msg: UploadBookMessage): Promise<UploadBookResponse> {
    const filename = cleanText(msg?.filename, 255);
    if (!filename || !/\.epub$/i.test(filename)) {
      throw bookError(400, 'Upload an .epub file');
    }
    const bytes = new Uint8Array(
      Buffer.from(msg.contentBase64 ?? '', 'base64'),
    );
    if (bytes.length === 0) throw bookError(400, 'The uploaded file is empty');
    if (bytes.length > MAX_UPLOAD_BYTES) {
      throw bookError(413, 'EPUB files are limited to 50 MB');
    }

    const parsed = this.parse(bytes);
    const id = stableBookId(filename);
    const fileKey = `epubs/${id}.epub`;
    await this.storage.put(fileKey, bytes, 'application/epub+zip');

    let coverKey: string | null = null;
    if (parsed.cover) {
      coverKey = `covers/${id}${parsed.cover.extension}`;
      await this.storage.put(
        coverKey,
        parsed.cover.bytes,
        parsed.cover.contentType,
      );
    }

    const book = await this.create({
      id,
      title: parsed.title,
      author: parsed.author,
      categories: parsed.categories,
      publishedDate: parsed.publishedDate,
      description: parsed.description,
      coverUrl: coverKey,
      fileKey,
    });

    const indexingQueued = await this.queueIndexing(book, parsed);
    return {
      book,
      chapterCount: parsed.chapters.length,
      chunkCount: parsed.chapters.reduce((n, c) => n + c.chunks.length, 0),
      indexingQueued,
    };
  }

  /** Re-parse the stored EPUB and send it to the indexing service again. */
  async reindex(id: string): Promise<UploadBookResponse> {
    const row = await this.getRow(id);
    const key = this.storage.keyFor(row.fileKey);
    if (!key) throw bookError(404, 'No EPUB file is stored for this book');

    let bytes: Uint8Array;
    try {
      bytes = await this.storage.get(key);
    } catch (err) {
      this.logger.error(
        `Reading ${key} failed: ${err instanceof Error ? err.message : err}`,
      );
      throw bookError(502, 'Could not read the stored EPUB file');
    }
    const parsed = this.parse(bytes);
    const book = this.toItem(row);
    const indexingQueued = await this.queueIndexing(book, parsed);
    return {
      book,
      chapterCount: parsed.chapters.length,
      chunkCount: parsed.chapters.reduce((n, c) => n + c.chunks.length, 0),
      indexingQueued,
    };
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private parse(bytes: Uint8Array): ParsedEpub {
    let parsed: ParsedEpub;
    try {
      parsed = parseEpub(bytes);
    } catch (err) {
      if (err instanceof EpubParseError) throw bookError(422, err.message);
      throw err;
    }
    if (parsed.chapters.length === 0) {
      throw bookError(422, 'No readable text found in this EPUB');
    }
    return parsed;
  }

  private async queueIndexing(
    book: BookItem,
    parsed: ParsedEpub,
  ): Promise<boolean> {
    const payload: ProcessBookIndexDto = {
      bookId: book.id,
      title: book.title,
      author: book.author,
      chapters: parsed.chapters,
    };
    return this.emitIndexing(PATTERNS.INDEXING.PROCESS_BOOK, payload);
  }

  /** Fire-and-forget to the indexing queue; a broker outage is logged, not fatal. */
  private async emitIndexing(
    pattern: string,
    payload: unknown,
  ): Promise<boolean> {
    try {
      await firstValueFrom(this.indexing.emit(pattern, payload), {
        defaultValue: undefined,
      });
      return true;
    } catch (err) {
      this.logger.error(
        `Could not publish ${pattern}: ${err instanceof Error ? err.message : err}`,
      );
      return false;
    }
  }

  private async getRow(id: string): Promise<BookRow> {
    const cleanId = cleanText(id, 200);
    const row = cleanId
      ? await this.prisma.book.findUnique({ where: { id: cleanId } })
      : null;
    if (!row) throw bookError(404, 'Book not found');
    return row;
  }

  private toItem(row: BookRow): BookItem {
    return {
      id: row.id,
      title: row.title,
      author: row.author,
      categories: row.categories ?? [],
      publishedDate: row.publishedDate,
      description: row.description,
      coverUrl: this.storage.browserUrl(row.coverUrl),
      hasFile: Boolean(this.storage.keyFor(row.fileKey)),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
