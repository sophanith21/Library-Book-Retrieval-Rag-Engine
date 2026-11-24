import { EmbeddingService } from '@app/embeddings';
import { DenseIndexRepository } from './dense-index.repository';
import { IndexingService } from './indexing.service';
import { InvertedIndexRepository } from './inverted-index.repository';

describe('IndexingService (dense indexing append)', () => {
  const makeMocks = () => {
    const invertedRepo = {
      markIndexing: jest.fn().mockResolvedValue(undefined),
      replaceBook: jest.fn().mockResolvedValue(undefined),
      getBookStatus: jest.fn().mockResolvedValue({
        bookId: 'book-1',
        status: 'done',
        chunkCount: 2,
        tokenCount: 10,
      }),
      markFailed: jest.fn().mockResolvedValue(undefined),
      refreshStats: jest.fn(),
    } as unknown as jest.Mocked<InvertedIndexRepository>;

    const denseRepo = {
      findChunksWithoutEmbeddings: jest.fn().mockResolvedValue([
        { chunkId: '101', content: 'Quantum entanglement passage.' },
        { chunkId: '102', content: 'Superposition in qubits.' },
      ]),
      updateChunkEmbeddings: jest.fn().mockResolvedValue(2),
      countMissingEmbeddings: jest.fn().mockResolvedValue(0),
    } as unknown as jest.Mocked<DenseIndexRepository>;

    const embeddings = {
      model: 'BAAI/bge-small-en-v1.5',
      dimensions: 384,
      isEnabled: jest.fn().mockReturnValue(true),
      embedDocuments: jest.fn().mockResolvedValue([
        new Array(384).fill(0.05),
        new Array(384).fill(0.05),
      ]),
    } as unknown as jest.Mocked<EmbeddingService>;

    return {
      service: new IndexingService(invertedRepo, denseRepo, embeddings),
      invertedRepo,
      denseRepo,
      embeddings,
    };
  };

  it('embeds unembedded chunks in embedBook()', async () => {
    const { service, denseRepo, embeddings } = makeMocks();

    const res = await service.embedBook({ bookId: 'book-1' });

    expect(denseRepo.findChunksWithoutEmbeddings).toHaveBeenCalledWith(
      'book-1',
      10_000,
    );
    expect(embeddings.embedDocuments).toHaveBeenCalledWith([
      'Quantum entanglement passage.',
      'Superposition in qubits.',
    ]);
    expect(denseRepo.updateChunkEmbeddings).toHaveBeenCalledTimes(1);
    expect(res.embeddedChunks).toBe(2);
    expect(res.remainingChunks).toBe(0);
    expect(res.model).toBe('BAAI/bge-small-en-v1.5');
    expect(res.dimensions).toBe(384);
  });

  it('keeps sparse indexing succeeding even if dense embedding provider is offline', async () => {
    const { service, invertedRepo, embeddings } = makeMocks();
    embeddings.embedDocuments.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const status = await service.indexBook({
      bookId: 'book-1',
      title: 'Quantum Book',
      author: 'Author',
      chapters: [{ chapterNo: 1, chunks: ['Quantum mechanics intro.'] }],
    });

    expect(invertedRepo.replaceBook).toHaveBeenCalledTimes(1);
    expect(invertedRepo.markFailed).not.toHaveBeenCalled();
    expect(status.status).toBe('done');
  });
});
