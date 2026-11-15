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
  },
  RETRIEVAL: {
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
