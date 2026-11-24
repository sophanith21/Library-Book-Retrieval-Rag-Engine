import {
  DEFAULT_BGE_QUERY_PREFIX,
  EmbeddingService,
  l2Normalize,
  toPgVectorSql,
} from './embeddings.service';

describe('EmbeddingService', () => {
  const originalEnv = process.env;
  const originalFetch = global.fetch;

  beforeEach(() => {
    process.env = { ...originalEnv };
    jest.restoreAllMocks();
  });

  afterAll(() => {
    process.env = originalEnv;
    global.fetch = originalFetch;
  });

  it('l2Normalize scales a vector to unit length', () => {
    const normalized = l2Normalize([3, 4]);
    expect(normalized[0]).toBeCloseTo(0.6);
    expect(normalized[1]).toBeCloseTo(0.8);
  });

  it('toPgVectorSql formats a vector as a pgvector literal', () => {
    expect(toPgVectorSql([0.5, -0.25, 1])).toBe('[0.5,-0.25,1]');
  });

  it('calls TEI /embed in batches and normalizes document embeddings', async () => {
    process.env.EMBEDDING_PROVIDER = 'tei';
    process.env.EMBEDDING_API_URL = 'http://embeddings:80';
    process.env.EMBEDDING_DIMENSIONS = '2';
    process.env.EMBEDDING_BATCH_SIZE = '2';

    const fetchMock = jest.fn().mockImplementation(async (_url, init) => {
      const body = JSON.parse(init.body as string) as { inputs: string[] };
      return {
        ok: true,
        json: async () => body.inputs.map(() => [3, 4]),
      };
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const service = new EmbeddingService();
    const vectors = await service.embedDocuments(['a', 'b', 'c']);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'http://embeddings:80/embed',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(vectors).toHaveLength(3);
    expect(vectors[0][0]).toBeCloseTo(0.6);
    expect(vectors[0][1]).toBeCloseTo(0.8);
  });

  it('prepends the BGE query instruction prefix in embedQuery', async () => {
    process.env.EMBEDDING_PROVIDER = 'tei';
    process.env.EMBEDDING_DIMENSIONS = '2';

    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => [[1, 0]],
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const service = new EmbeddingService();
    await service.embedQuery('quantum computation');

    const sentBody = JSON.parse(
      (fetchMock.mock.calls[0][1] as RequestInit).body as string,
    ) as { inputs: string[] };
    expect(sentBody.inputs).toEqual([
      `${DEFAULT_BGE_QUERY_PREFIX}quantum computation`,
    ]);
  });

  it('throws on dimension mismatch', async () => {
    process.env.EMBEDDING_PROVIDER = 'tei';
    process.env.EMBEDDING_DIMENSIONS = '384';

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => [[0.1, 0.2]],
    }) as unknown as typeof fetch;

    const service = new EmbeddingService();
    await expect(service.embedDocuments(['hello'])).rejects.toThrow(
      /dimension mismatch/i,
    );
  });

  it('reports disabled when EMBEDDING_PROVIDER=none', () => {
    process.env.EMBEDDING_PROVIDER = 'none';
    const service = new EmbeddingService();
    expect(service.isEnabled()).toBe(false);
  });
});
