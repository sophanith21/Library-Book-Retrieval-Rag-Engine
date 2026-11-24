import { EmbeddingService } from '@app/embeddings';
import { Bm25SearchRepository } from './bm25-search.repository';
import { DenseSearchRepository } from './dense-search.repository';
import { RetrievalService } from './retrieval.service';

describe('RetrievalService (dense search append)', () => {
  const makeMocks = () => {
    const bm25Repo = {
      lookupTerms: jest.fn(),
      rankBooks: jest.fn(),
      termSpans: jest.fn(),
    } as unknown as jest.Mocked<Bm25SearchRepository>;

    const denseRepo = {
      rankBooks: jest.fn().mockResolvedValue({
        total: 1,
        hits: [
          {
            bookId: 'book-1',
            title: 'Introduction to Quantum Mechanics',
            author: 'David J. Griffiths',
            chunkId: '42',
            chapterNo: 2,
            chunkNo: 1,
            content: 'Quantum superposition enables parallel state amplitudes.',
            score: 0.912,
          },
        ],
      }),
      rankChunks: jest.fn().mockResolvedValue([
        {
          chunkId: '42',
          bookId: 'book-1',
          title: 'Introduction to Quantum Mechanics',
          author: 'David J. Griffiths',
          chapterNo: 2,
          chunkNo: 1,
          content: 'Quantum superposition enables parallel state amplitudes.',
          similarity: 0.912,
          rank: 1,
        },
      ]),
    } as unknown as jest.Mocked<DenseSearchRepository>;

    const embeddings = {
      model: 'BAAI/bge-small-en-v1.5',
      dimensions: 384,
      embedQuery: jest.fn().mockResolvedValue(new Array(384).fill(0.05)),
    } as unknown as jest.Mocked<EmbeddingService>;

    return {
      service: new RetrievalService(bm25Repo, denseRepo, embeddings),
      bm25Repo,
      denseRepo,
      embeddings,
    };
  };

  it('short-circuits empty queries without calling embedding provider', async () => {
    const { service, embeddings, denseRepo } = makeMocks();

    const res = await service.denseSearch({ query: '   ' });

    expect(embeddings.embedQuery).not.toHaveBeenCalled();
    expect(denseRepo.rankBooks).not.toHaveBeenCalled();
    expect(res.results).toEqual([]);
    expect(res.topChunks).toEqual([]);
  });

  it('encodes the query and returns deduplicated book results + ranked chunks', async () => {
    const { service, embeddings, denseRepo, bm25Repo } = makeMocks();

    const res = await service.denseSearch({
      query: 'quantum superposition',
      limit: 5,
      offset: 0,
      topKChunks: 10,
    });

    expect(bm25Repo.rankBooks).not.toHaveBeenCalled();
    expect(embeddings.embedQuery).toHaveBeenCalledWith('quantum superposition');
    expect(denseRepo.rankBooks).toHaveBeenCalledWith(
      expect.any(Array),
      5,
      0,
    );
    expect(denseRepo.rankChunks).toHaveBeenCalledWith(expect.any(Array), 10);
    expect(res.model).toBe('BAAI/bge-small-en-v1.5');
    expect(res.total).toBe(1);
    expect(res.results[0].bookId).toBe('book-1');
    expect(res.results[0].score).toBeCloseTo(0.912);
    expect(res.topChunks[0]).toMatchObject({
      chunkId: '42',
      rank: 1,
      similarity: 0.912,
    });
  });
});
