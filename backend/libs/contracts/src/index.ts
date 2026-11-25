import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export const SERVICES = {
  AUTH: 'AUTH_SERVICE',
  BOOK: 'BOOK_SERVICE',
  INDEXING: 'INDEXING_SERVICE',
  RETRIEVAL: 'RETRIEVAL_SERVICE',
  LLM: 'LLM_SERVICE',
} as const;

export const QUEUES = {
  AUTH: 'auth_queue',
  BOOK: 'book_queue',
  INDEXING: 'indexing_queue',
  RETRIEVAL: 'retrieval_queue',
  LLM: 'llm_queue',
} as const;

export const PATTERNS = {
  AUTH: {
    REGISTER: 'auth.register',
    LOGIN: 'auth.login',
    VALIDATE: 'auth.validate',
  },
  BOOK: {
    FIND_ALL: 'book.findAll',
    FIND_BY_ID: 'book.findById',
    CREATE: 'book.create',
    GET_FILE_URL: 'book.getFileUrl',
  },
  INDEXING: {
    PROCESS_BOOK: 'indexing.processBook',
    GET_STATUS: 'indexing.getStatus',
    GET_STATS: 'indexing.getStats',
    FINALIZE: 'indexing.finalize',
    EMBED_BOOK: 'indexing.embedBook',
  },
  RETRIEVAL: {
    SEARCH: 'retrieval.search',
    DENSE_SEARCH: 'retrieval.denseSearch',
    HYBRID_SEARCH: 'retrieval.hybridSearch',
  },
  LLM: {
    SYNTHESIZE: 'llm.synthesize',
  },
} as const;

export class RegisterDto {
  @ApiProperty({
    example: 'student@example.com',
    description: 'User email address',
  })
  email!: string;

  @ApiProperty({
    example: 'Password123!',
    description: 'User password',
    minLength: 8,
  })
  password!: string;

  @ApiPropertyOptional({
    example: 'student',
    description: 'User role (defaults to student if not provided)',
    enum: ['student', 'admin'],
    default: 'student',
  })
  role?: 'student' | 'admin';
}

export class LoginDto {
  @ApiProperty({
    example: 'student@example.com',
    description: 'Registered user email address',
  })
  email!: string;

  @ApiProperty({
    example: 'Password123!',
    description: 'User password',
  })
  password!: string;
}

export class AuthUser {
  @ApiProperty({
    example: '550e8400-e29b-41d4-a716-446655440000',
    description: 'Unique user ID',
  })
  id!: string;

  @ApiProperty({
    example: 'student@example.com',
    description: 'User email address',
  })
  email!: string;

  @ApiProperty({
    example: 'student',
    description: 'User role',
    enum: ['student', 'admin'],
  })
  role!: string;
}

export class AuthResponse {
  @ApiProperty({
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
    description: 'JWT access token',
  })
  accessToken!: string;

  @ApiProperty({
    type: AuthUser,
    description: 'Authenticated user information',
  })
  user!: AuthUser;
}

export class ValidateTokenDto {
  @ApiProperty({
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
    description: 'JWT access token to validate',
  })
  accessToken!: string;
}

export class CreateBookDto {
  id?: string;
  title!: string;
  author!: string;
  coverUrl?: string;
  fileKey?: string;
}

export class BookItem {
  id!: string;
  title!: string;
  author!: string;
  coverUrl?: string | null;
  fileKey?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export class ChapterChunk {
  chapterNo!: number;
  chunkNo!: number;
  content!: string;
}

export class ChapterItem {
  chapterNo!: number;
  chunks!: string[];
}

export class ProcessBookIndexDto {
  bookId!: string;
  title!: string;
  author!: string;
  chapters!: ChapterItem[];
}

export type IndexStatus = 'pending' | 'indexing' | 'done' | 'failed';

export class BookIndexStatus {
  bookId!: string;
  status!: IndexStatus | 'not_found';
  chunkCount!: number;
  tokenCount!: number;
  error?: string | null;
  indexedAt?: Date | null;
}

export class IndexStatsResponse {
  totalChunks!: number;
  totalBooks!: number;
  dirtyBooks!: number;
  totalTerms!: number;
  avgChunkLen!: number;
  updatedAt!: Date;
}

// ---------------------------------------------------------------------------
// BM25 keyword search (inverted index)
// ---------------------------------------------------------------------------

export class SearchQueryDto {
  query!: string;
  /** Results per page (default 10, max 50) */
  limit?: number;
  offset?: number;
}

/** [start, end) character range inside Snippet.text to emphasise. */
export class HighlightSpan {
  start!: number;
  end!: number;
}

/**
 * Plain text plus highlight ranges, rather than HTML, so the client renders
 * <mark> itself and book text can never inject markup.
 */
export class Snippet {
  text!: string;
  highlights!: HighlightSpan[];
}

export class SearchResultItem {
  bookId!: string;
  title!: string;
  author!: string | null;
  /** BM25 score of the book's best-matching chunk */
  score!: number;
  /** How many distinct query terms that chunk contains */
  matchedTerms!: number;
  chapterNo!: number;
  chunkNo!: number;
  snippet!: Snippet;
}

export class SearchResponse {
  query!: string;
  /** Normalised terms actually searched (after stopwords and stemming) */
  terms!: string[];
  /** Number of matching books across all pages */
  total!: number;
  limit!: number;
  offset!: number;
  tookMs!: number;
  results!: SearchResultItem[];
}

// ---------------------------------------------------------------------------
// Dense vector indexing & retrieval (pgvector HNSW)
// ---------------------------------------------------------------------------

export class EmbedBookDto {
  /** Optional bookId; if omitted, backfills all chunks missing embeddings */
  bookId?: string;
  /** Max chunks to embed in one call (default: all for a book, 500 for global backfill) */
  limit?: number;
}

export class EmbedBookResponse {
  bookId?: string;
  model!: string;
  dimensions!: number;
  embeddedChunks!: number;
  remainingChunks!: number;
  tookMs!: number;
}

export class DenseSearchQueryDto {
  query!: string;
  /** Results per page (default 10, max 50) */
  limit?: number;
  offset?: number;
  /** Number of top chunks to return for RRF / RAG (default 20, max 100) */
  topKChunks?: number;
}

export class DenseChunkResult {
  chunkId!: string;
  bookId!: string;
  title!: string;
  author!: string | null;
  chapterNo!: number;
  chunkNo!: number;
  content!: string;
  /** Cosine similarity in [-1, 1] (higher is closer) */
  similarity!: number;
  /** 1-based dense rank */
  rank!: number;
}

export class DenseSearchResultItem {
  bookId!: string;
  title!: string;
  author!: string | null;
  /** Cosine similarity of the book's best-matching chunk */
  score!: number;
  chapterNo!: number;
  chunkNo!: number;
  snippet!: Snippet;
}

export class DenseSearchResponse {
  query!: string;
  model!: string;
  /** Number of matching books across all pages */
  total!: number;
  limit!: number;
  offset!: number;
  tookMs!: number;
  results!: DenseSearchResultItem[];
  /** Top-K ranked chunks for downstream RRF fusion or RAG */
  topChunks!: DenseChunkResult[];
}

export class HybridSearchQueryDto {
  query!: string;
  limit?: number;
  rrfK?: number;
}

export class RankedChunk {
  chunkId!: number | string;
  bookId!: string;
  chapterNo!: number;
  chunkNo!: number;
  content!: string;
  sparseRank?: number;
  denseRank?: number;
  rrfScore!: number;
}

export class SearchResultBookCard {
  bookId!: string;
  title!: string;
  author!: string;
  coverUrl?: string | null;
  topSnippet!: string;
  highestRrfScore!: number;
}

export class HybridSearchResponse {
  query!: string;
  topFusedChunks!: RankedChunk[];
  books!: SearchResultBookCard[];
}

export class ChunkContextItem {
  bookId!: string;
  title?: string;
  author?: string;
  chapterNo?: number;
  content!: string;
}

export class SynthesizeQueryDto {
  query!: string;
  chunks!: ChunkContextItem[];
}

export class CitationItem {
  bookId!: string;
  title?: string;
  author?: string;
  chapterNo?: number;
  quoteSnippet!: string;
}

export class SynthesizeResponse {
  overview!: string;
  citations!: CitationItem[];
}

export * from './contracts.module';
export * from './contracts.service';
