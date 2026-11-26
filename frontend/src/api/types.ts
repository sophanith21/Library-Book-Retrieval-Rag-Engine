// Mirrors backend/libs/contracts/src/index.ts (the frontend can't import it
// directly). Keep the two in sync when the API changes.

export type Role = "student" | "admin";

export interface AuthUser {
  id: string;
  email: string;
  role: Role;
}

export interface AuthResponse {
  accessToken: string;
  user: AuthUser;
}

export interface Book {
  id: string;
  title: string;
  author: string;
  categories: string[];
  publishedDate: string | null;
  description: string | null;
  coverUrl: string | null;
  hasFile: boolean;
  createdAt: string;
  updatedAt: string;
}

export type BookSort = "title" | "author" | "newest";

export interface BookListResponse {
  total: number;
  limit: number;
  offset: number;
  items: Book[];
}

export interface CategoryCount {
  name: string;
  count: number;
}

export interface BookFileUrl {
  url: string;
  expiresIn: number;
  filename: string;
}

export interface BookPatch {
  title?: string;
  author?: string;
  categories?: string[];
  publishedDate?: string | null;
  description?: string | null;
}

export interface UploadBookResponse {
  book: Book;
  chapterCount: number;
  chunkCount: number;
  indexingQueued: boolean;
}

export interface HighlightSpan {
  start: number;
  end: number;
}

export interface Snippet {
  text: string;
  highlights: HighlightSpan[];
}

export interface SearchHit {
  bookId: string;
  title: string;
  author: string | null;
  score: number;
  matchedTerms?: number;
  chapterNo: number;
  chunkNo: number;
  snippet: Snippet;
}

export interface SearchResponse {
  query: string;
  /** Stemmed terms actually searched (keyword mode only) */
  terms?: string[];
  /** Embedding model (semantic mode only) */
  model?: string;
  total: number;
  limit: number;
  offset: number;
  tookMs: number;
  results: SearchHit[];
}

export type SearchMode = "keyword" | "semantic";

export type IndexState =
  "pending" | "indexing" | "done" | "failed" | "not_found";

export interface BookIndexStatus {
  bookId: string;
  status: IndexState;
  chunkCount: number;
  tokenCount: number;
  error?: string | null;
  indexedAt?: string | null;
}

export interface IndexStats {
  totalChunks: number;
  totalBooks: number;
  dirtyBooks: number;
  totalTerms: number;
  avgChunkLen: number;
  updatedAt: string;
}

export interface EmbedResponse {
  bookId?: string;
  model: string;
  dimensions: number;
  embeddedChunks: number;
  remainingChunks: number;
  tookMs: number;
}
