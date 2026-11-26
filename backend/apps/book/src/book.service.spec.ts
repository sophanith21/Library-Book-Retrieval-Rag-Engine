import { RpcException } from '@nestjs/microservices';
import { strToU8, zipSync } from 'fflate';
import { of, throwError } from 'rxjs';
import { PATTERNS } from '@app/contracts';
import { BookService } from './book.service';
import { ObjectStorageService } from './storage/object-storage.service';

const now = new Date('2026-01-01T00:00:00Z');
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
interface FindManyArgs {
  where: {
    OR?: { title: unknown }[];
    categories?: unknown;
  };
}

const baseRow = (): BookRow => ({
  id: 'book-moby-dick',
  title: 'Moby Dick',
  author: 'Herman Melville',
  categories: ['Sea stories'],
  publishedDate: '1851',
  description: null,
  coverUrl: 'http://localhost:8333/books/covers/book-moby-dick.jpg',
  fileKey: 'epubs/book-moby-dick.epub',
  createdAt: now,
  updatedAt: now,
});
const row = (over: Partial<BookRow> = {}): BookRow => ({
  ...baseRow(),
  ...over,
});

function epub(): string {
  const para = Array.from({ length: 50 }, (_, i) => `word${i}`).join(' ');
  return Buffer.from(
    zipSync({
      'META-INF/container.xml': strToU8(
        '<container><rootfiles><rootfile full-path="content.opf"/></rootfiles></container>',
      ),
      'content.opf': strToU8(`<package><metadata>
          <dc:title>Moby Dick</dc:title><dc:creator>Herman Melville</dc:creator>
        </metadata><manifest>
          <item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/>
          <item id="img" href="cover.png" media-type="image/png" properties="cover-image"/>
        </manifest><spine><itemref idref="c1"/></spine></package>`),
      'c1.xhtml': strToU8(`<html><body><p>${para}</p></body></html>`),
      'cover.png': new Uint8Array([1, 2, 3]),
    }),
  ).toString('base64');
}

function setup() {
  const prisma = {
    book: {
      count: jest.fn().mockResolvedValue(1),
      findMany: jest
        .fn<Promise<BookRow[]>, [FindManyArgs]>()
        .mockResolvedValue([row()]),
      findUnique: jest.fn().mockResolvedValue(row()),
      upsert: jest.fn((args: { create: Partial<BookRow> }) =>
        Promise.resolve(row(args.create)),
      ),
      update: jest.fn((args: { data: Partial<BookRow> }) =>
        Promise.resolve(row(args.data)),
      ),
      delete: jest.fn().mockResolvedValue(row()),
    },
    $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
    $queryRaw: jest
      .fn()
      .mockResolvedValue([{ name: 'Sea stories', count: 3n }]),
  };
  const storage = new ObjectStorageService();
  // Spies are kept as values so assertions don't reference unbound methods.
  const put = jest.spyOn(storage, 'put').mockResolvedValue();
  const remove = jest.spyOn(storage, 'delete').mockResolvedValue();
  const get = jest
    .spyOn(storage, 'get')
    .mockResolvedValue(new Uint8Array(Buffer.from(epub(), 'base64')));
  const indexing = { emit: jest.fn().mockReturnValue(of(undefined)) };
  const service = new BookService(prisma as never, storage, indexing as never);
  return { service, prisma, storage: { put, remove, get }, indexing };
}

const rpcStatus = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (err) {
    expect(err).toBeInstanceOf(RpcException);
    return ((err as RpcException).getError() as { statusCode: number })
      .statusCode;
  }
  throw new Error('expected an RpcException');
};

describe('BookService', () => {
  it('lists books with search, category filter and presigned covers', async () => {
    const { service, prisma } = setup();
    const res = await service.findAll({
      q: ' moby ',
      category: 'Sea stories',
      limit: 500,
    });

    expect(res.limit).toBe(100);
    const args = prisma.book.findMany.mock.calls[0][0];
    expect(args.where.OR?.[0].title).toEqual({
      contains: 'moby',
      mode: 'insensitive',
    });
    expect(args.where.categories).toEqual({ has: 'Sea stories' });
    expect(res.items[0].coverUrl).toMatch(
      /^http:\/\/localhost:8333\/books\/covers\/book-moby-dick\.jpg\?X-Amz-Algorithm=/,
    );
    expect(res.items[0].hasFile).toBe(true);
    expect(res.items[0]).not.toHaveProperty('fileKey');
  });

  it('leaves external cover URLs untouched', async () => {
    const { service, prisma } = setup();
    prisma.book.findUnique.mockResolvedValue(
      row({ coverUrl: 'https://example.org/c.jpg' }),
    );
    expect((await service.findById('book-moby-dick')).coverUrl).toBe(
      'https://example.org/c.jpg',
    );
  });

  it('returns 404 for unknown books and books without a file', async () => {
    const { service, prisma } = setup();
    prisma.book.findUnique.mockResolvedValueOnce(null);
    expect(await rpcStatus(service.findById('nope'))).toBe(404);
    prisma.book.findUnique.mockResolvedValueOnce(row({ fileKey: null }));
    expect(await rpcStatus(service.getFileUrl('book-moby-dick'))).toBe(404);
  });

  it('presigns a download URL named after the title', async () => {
    const { service } = setup();
    const res = await service.getFileUrl('book-moby-dick');
    expect(res.filename).toBe('Moby Dick.epub');
    expect(decodeURIComponent(res.url)).toContain(
      'attachment; filename="Moby Dick.epub"',
    );
  });

  it('accepts the ingest2.py field names on create', async () => {
    const { service, prisma } = setup();
    await service.create({
      id: 'x-1',
      title: 'T',
      category: ['A', 'A', 'B'],
      date: '1900',
    });
    const { create } = prisma.book.upsert.mock.calls[0][0];
    expect(create).toMatchObject({
      id: 'x-1',
      author: 'Unknown',
      categories: ['A', 'B'],
      publishedDate: '1900',
    });
  });

  it('validates create and update input', async () => {
    const { service } = setup();
    expect(await rpcStatus(service.create({ title: '  ' }))).toBe(400);
    expect(await rpcStatus(service.create({ id: '../x', title: 'T' }))).toBe(
      400,
    );
    expect(
      await rpcStatus(service.update('book-moby-dick', { title: '' })),
    ).toBe(400);
  });

  it('stores, registers and queues an uploaded EPUB', async () => {
    const { service, storage, indexing, prisma } = setup();
    const res = await service.upload({
      filename: 'Moby Dick.epub',
      contentBase64: epub(),
    });

    expect(storage.put).toHaveBeenCalledWith(
      'epubs/book-moby-dick.epub',
      expect.any(Uint8Array),
      'application/epub+zip',
    );
    expect(storage.put).toHaveBeenCalledWith(
      'covers/book-moby-dick.png',
      new Uint8Array([1, 2, 3]),
      'image/png',
    );
    expect(prisma.book.upsert.mock.calls[0][0].create).toMatchObject({
      id: 'book-moby-dick',
      title: 'Moby Dick',
      fileKey: 'epubs/book-moby-dick.epub',
      coverUrl: 'covers/book-moby-dick.png',
    });
    expect(indexing.emit).toHaveBeenCalledWith(
      PATTERNS.INDEXING.PROCESS_BOOK,
      expect.objectContaining({
        bookId: 'book-moby-dick',
        chapters: [expect.objectContaining({ chapterNo: 1 })],
      }),
    );
    expect(res).toMatchObject({
      chapterCount: 1,
      chunkCount: 1,
      indexingQueued: true,
    });
  });

  it('rejects non-EPUB uploads before storing anything', async () => {
    const { service, storage } = setup();
    expect(
      await rpcStatus(
        service.upload({ filename: 'a.pdf', contentBase64: 'AA==' }),
      ),
    ).toBe(400);
    expect(
      await rpcStatus(
        service.upload({
          filename: 'a.epub',
          contentBase64: Buffer.from('nope').toString('base64'),
        }),
      ),
    ).toBe(422);
    expect(storage.put).not.toHaveBeenCalled();
  });

  it('still saves the book when the indexing queue is down', async () => {
    const { service, indexing } = setup();
    indexing.emit.mockReturnValue(throwError(() => new Error('broker down')));
    const res = await service.upload({
      filename: 'm.epub',
      contentBase64: epub(),
    });
    expect(res.indexingQueued).toBe(false);
  });

  it('deletes the row, its files and its index entries', async () => {
    const { service, storage, indexing, prisma } = setup();
    await service.delete('book-moby-dick');
    expect(prisma.book.delete).toHaveBeenCalledWith({
      where: { id: 'book-moby-dick' },
    });
    expect(storage.remove).toHaveBeenCalledWith('epubs/book-moby-dick.epub');
    expect(storage.remove).toHaveBeenCalledWith('covers/book-moby-dick.jpg');
    expect(indexing.emit).toHaveBeenCalledWith(PATTERNS.INDEXING.DELETE_BOOK, {
      bookId: 'book-moby-dick',
    });
  });

  it('re-indexes from the stored EPUB', async () => {
    const { service, storage, indexing } = setup();
    const res = await service.reindex('book-moby-dick');
    expect(storage.get).toHaveBeenCalledWith('epubs/book-moby-dick.epub');
    expect(indexing.emit).toHaveBeenCalledWith(
      PATTERNS.INDEXING.PROCESS_BOOK,
      expect.anything(),
    );
    expect(res.chunkCount).toBe(1);
  });

  it('counts categories', async () => {
    const { service } = setup();
    expect(await service.categories()).toEqual([
      { name: 'Sea stories', count: 3 },
    ]);
  });
});
