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
    CATEGORIES: 'book.categories',
    CREATE: 'book.create',
    UPDATE: 'book.update',
    DELETE: 'book.delete',
    UPLOAD: 'book.upload',
    REINDEX: 'book.reindex',
    GET_FILE_URL: 'book.getFileUrl',
  },
  INDEXING: {
    PROCESS_BOOK: 'indexing.processBook',
    DELETE_BOOK: 'indexing.deleteBook',
    GET_STATUS: 'indexing.getStatus',
    GET_STATUSES: 'indexing.getStatuses',
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

/**
 * Register book metadata. Also accepts the field names ingest2.py sends
 * (`category`, `date`) so existing ingestion scripts work unchanged.
 */
export class CreateBookDto {
  @ApiPropertyOptional({ example: 'book-herman-melville-moby-dick' })
  id?: string;
  @ApiProperty({ example: 'Moby Dick' })
  title!: string;
  @ApiPropertyOptional({ example: 'Herman Melville', default: 'Unknown' })
  author?: string;
  @ApiPropertyOptional({ type: [String], example: ['Sea stories'] })
  categories?: string[];
  @ApiPropertyOptional({ type: [String], description: 'Alias of categories' })
  category?: string[];
  @ApiPropertyOptional({ example: '1851' })
  publishedDate?: string | null;
  @ApiPropertyOptional({ description: 'Alias of publishedDate' })
  date?: string | null;
  @ApiPropertyOptional()
  description?: string | null;
  @ApiPropertyOptional({ description: 'Storage key or absolute URL' })
  coverUrl?: string | null;
  @ApiPropertyOptional({ example: 'epubs/moby-dick.epub' })
  fileKey?: string | null;
}

export class UpdateBookDto {
  @ApiPropertyOptional()
  title?: string;
  @ApiPropertyOptional()
  author?: string;
  @ApiPropertyOptional({ type: [String] })
  categories?: string[];
  @ApiPropertyOptional()
  publishedDate?: string | null;
  @ApiPropertyOptional()
  description?: string | null;
}

/** RPC payload for book.update (the id travels next to the patch). */
export class UpdateBookMessage {
  id!: string;
  patch!: UpdateBookDto;
}

export class BookItem {
  @ApiProperty()
  id!: string;
  @ApiProperty()
  title!: string;
  @ApiProperty()
  author!: string;
  @ApiProperty({ type: [String] })
  categories!: string[];
  @ApiPropertyOptional()
  publishedDate!: string | null;
  @ApiPropertyOptional()
  description!: string | null;
  /** Browser-loadable cover URL (presigned when stored in object storage) */
  @ApiPropertyOptional()
  coverUrl!: string | null;
  @ApiProperty({ description: 'Whether an EPUB file is stored for this book' })
  hasFile!: boolean;
  @ApiProperty()
  createdAt!: Date;
  @ApiProperty()
  updatedAt!: Date;
}

export class ListBooksQueryDto {
  /** Case-insensitive match on title or author */
  q?: string;
  category?: string;
  limit?: number;
  offset?: number;
  sort?: 'title' | 'author' | 'newest';
}

export class BookListResponse {
  @ApiProperty()
  total!: number;
  @ApiProperty()
  limit!: number;
  @ApiProperty()
  offset!: number;
  @ApiProperty({ type: [BookItem] })
  items!: BookItem[];
}

export class CategoryCount {
  @ApiProperty()
  name!: string;
  @ApiProperty()
  count!: number;
}

export class BookFileUrlResponse {
  @ApiProperty()
  url!: string;
  @ApiProperty({ description: 'Seconds until the URL stops working' })
  expiresIn!: number;
  @ApiProperty()
  filename!: string;
}

/** RPC payload for book.upload: the gateway forwards the multipart file. */
export class UploadBookMessage {
  filename!: string;
  contentBase64!: string;
}

export class UploadBookResponse {
  @ApiProperty({ type: BookItem })
  book!: BookItem;
  @ApiProperty()
  chapterCount!: number;
  @ApiProperty()
  chunkCount!: number;
  @ApiProperty({
    description: 'True when the book was queued on the indexing service',
  })
  indexingQueued!: boolean;
}

export class DeleteBookResponse {
  @ApiProperty()
  id!: string;
  @ApiProperty()
  deleted!: boolean;
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
