import { Injectable, Logger } from '@nestjs/common';

export type EmbeddingProvider = 'tei' | 'openai' | 'ollama' | 'huggingface' | 'none';

export const DEFAULT_EMBEDDING_MODEL = 'BAAI/bge-small-en-v1.5';
export const DEFAULT_EMBEDDING_DIM = 384;
// Official BGE v1.5 retrieval instruction for short queries
export const DEFAULT_BGE_QUERY_PREFIX =
  'Represent this sentence for searching relevant passages: ';

const DEFAULT_BATCH_SIZE = 32;
const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Normalizes a vector to unit L2 length so cosine distance (<=> in pgvector)
 * is strictly consistent regardless of provider behavior.
 */
export function l2Normalize(vec: number[]): number[] {
  let sumSq = 0;
  for (let i = 0; i < vec.length; i++) {
    sumSq += vec[i] * vec[i];
  }
  const norm = Math.sqrt(sumSq);
  if (norm === 0 || !Number.isFinite(norm)) return vec;
  return vec.map((v) => v / norm);
}

/**
 * Formats a numeric vector as a pgvector SQL literal ('[0.1,0.2,...]').
 */
export function toPgVectorSql(vec: number[]): string {
  for (let i = 0; i < vec.length; i++) {
    if (!Number.isFinite(vec[i])) {
      throw new Error(`Invalid vector element at index ${i}: ${vec[i]}`);
    }
  }
  return `[${vec.join(',')}]`;
}

@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);
  readonly provider: EmbeddingProvider;
  readonly model: string;
  readonly dimensions: number;
  readonly apiUrl: string;
  readonly queryPrefix: string;
  readonly batchSize: number;
  readonly timeoutMs: number;
  private readonly apiKey: string;

  constructor() {
    this.provider = (
      process.env.EMBEDDING_PROVIDER ?? 'tei'
    ).toLowerCase() as EmbeddingProvider;
    this.model = process.env.EMBEDDING_MODEL ?? DEFAULT_EMBEDDING_MODEL;
    this.dimensions = Number(
      process.env.EMBEDDING_DIMENSIONS ?? DEFAULT_EMBEDDING_DIM,
    );
    this.apiUrl = (
      process.env.EMBEDDING_API_URL ??
      (this.provider === 'ollama'
        ? (process.env.OLLAMA_HOST ?? 'http://localhost:11434')
        : 'http://localhost:8080')
    ).replace(/\/+$/, '');
    this.queryPrefix =
      process.env.EMBEDDING_QUERY_PREFIX ?? DEFAULT_BGE_QUERY_PREFIX;
    this.batchSize = Math.max(
      1,
      Number(process.env.EMBEDDING_BATCH_SIZE ?? DEFAULT_BATCH_SIZE),
    );
    this.timeoutMs = Math.max(
      1000,
      Number(process.env.EMBEDDING_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS),
    );
    this.apiKey =
      process.env.EMBEDDING_API_KEY ?? process.env.HF_API_TOKEN ?? '';
  }

  isEnabled(): boolean {
    return this.provider !== 'none';
  }

  /**
   * Encode document chunks (no query instruction prefix).
   * Automatically batches large chunk lists.
   */
  async embedDocuments(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    if (!this.isEnabled()) {
      throw new Error('EmbeddingService is disabled (EMBEDDING_PROVIDER=none)');
    }

    const results: number[][] = [];
    for (let i = 0; i < texts.length; i += this.batchSize) {
      const batch = texts.slice(i, i + this.batchSize);
      const vectors = await this.callProvider(batch);
      for (const vec of vectors) {
        this.assertDimensions(vec);
        results.push(l2Normalize(vec));
      }
    }
    return results;
  }

  /**
   * Encode a search query (prepends BGE retrieval query instruction when configured).
   */
  async embedQuery(query: string): Promise<number[]> {
    const cleaned = query.trim();
    const input = this.queryPrefix ? `${this.queryPrefix}${cleaned}` : cleaned;
    const [vector] = await this.embedDocuments([input]);
    return vector;
  }

  private assertDimensions(vec: number[]): void {
    if (!Array.isArray(vec) || vec.length !== this.dimensions) {
      throw new Error(
        `Embedding dimension mismatch: expected ${this.dimensions}, got ${Array.isArray(vec) ? vec.length : typeof vec} (model=${this.model}, provider=${this.provider})`,
      );
    }
  }

  private async callProvider(inputs: string[]): Promise<number[][]> {
    switch (this.provider) {
      case 'tei':
        return this.callTei(inputs);
      case 'openai':
        return this.callOpenAi(inputs);
      case 'ollama':
        return this.callOllama(inputs);
      case 'huggingface':
        return this.callHuggingFace(inputs);
      default:
        throw new Error(`Unsupported EMBEDDING_PROVIDER: ${this.provider}`);
    }
  }

  /** HuggingFace Text Embeddings Inference (TEI): POST /embed */
  private async callTei(inputs: string[]): Promise<number[][]> {
    const res = await this.fetchWithTimeout(`${this.apiUrl}/embed`, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify({
        inputs,
        normalize: true,
        truncate: true,
      }),
    });
    const data = (await res.json()) as number[][] | number[];
    // TEI returns number[][] for array inputs; guard single-vector edge case.
    if (Array.isArray(data) && typeof data[0] === 'number') {
      return [data as number[]];
    }
    return data as number[][];
  }

  /** OpenAI-compatible embeddings API: POST /v1/embeddings */
  private async callOpenAi(inputs: string[]): Promise<number[][]> {
    const res = await this.fetchWithTimeout(`${this.apiUrl}/v1/embeddings`, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify({
        model: this.model,
        input: inputs,
      }),
    });
    const data = (await res.json()) as {
      data: Array<{ index: number; embedding: number[] }>;
    };
    return [...data.data]
      .sort((a, b) => a.index - b.index)
      .map((item) => item.embedding);
  }

  /** Ollama embeddings API: POST /api/embed */
  private async callOllama(inputs: string[]): Promise<number[][]> {
    const res = await this.fetchWithTimeout(`${this.apiUrl}/api/embed`, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify({
        model: this.model,
        input: inputs,
      }),
    });
    const data = (await res.json()) as { embeddings: number[][] };
    return data.embeddings;
  }

  /** HuggingFace Inference API (feature-extraction pipeline) */
  private async callHuggingFace(inputs: string[]): Promise<number[][]> {
    const url =
      process.env.EMBEDDING_API_URL ||
      `https://router.huggingface.co/hf-inference/models/${this.model}/pipeline/feature-extraction`;
    const res = await this.fetchWithTimeout(url, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify({
        inputs,
        options: { wait_for_model: true },
      }),
    });
    const data = (await res.json()) as number[][] | number[];
    if (Array.isArray(data) && typeof data[0] === 'number') {
      return [data as number[]];
    }
    return data as number[][];
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }
    return headers;
  }

  private async fetchWithTimeout(
    url: string,
    init: RequestInit,
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(url, { ...init, signal: controller.signal });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        this.logger.error(
          `Embedding request failed (${res.status} ${res.statusText}): ${body.slice(0, 300)}`,
        );
        throw new Error(
          `Embedding provider ${this.provider} returned HTTP ${res.status}`,
        );
      }
      return res;
    } finally {
      clearTimeout(timer);
    }
  }
}
