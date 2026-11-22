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
    FINALIZE: 'indexing.finalize',
  },
  RETRIEVAL: {
    SEARCH: 'retrieval.search',
    HYBRID_SEARCH: 'retrieval.hybridSearch',
  },
  LLM: {
    SYNTHESIZE: 'llm.synthesize',
  },
} as const;

// DTO Classes for proper NestJS reflection and metadata
export class RegisterDto {
  email!: string;
  password!: string;
  role?: 'student' | 'admin';
}

export class LoginDto {
  email!: string;
  password!: string;
}

export class AuthResponse {
  accessToken!: string;
  user!: {
    id: string;
    email: string;
    role: string;
  };
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
