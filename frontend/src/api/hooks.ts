import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { api } from "./client";
import type {
  Book,
  BookFileUrl,
  BookIndexStatus,
  BookListResponse,
  BookPatch,
  BookSort,
  CategoryCount,
  EmbedResponse,
  IndexStats,
  SearchMode,
  SearchResponse,
  UploadBookResponse,
} from "./types";

export interface BookListParams {
  q?: string;
  category?: string;
  sort?: BookSort;
  limit?: number;
  offset?: number;
}

// ---------------------------------------------------------------------------
// Catalogue
// ---------------------------------------------------------------------------

export function useBooks(params: BookListParams) {
  return useQuery({
    queryKey: ["books", params],
    queryFn: ({ signal }) =>
      api<BookListResponse>("/books", { query: { ...params }, signal }),
    placeholderData: keepPreviousData,
  });
}

export function useBook(id: string | undefined) {
  return useQuery({
    queryKey: ["book", id],
    queryFn: ({ signal }) =>
      api<Book>(`/books/${encodeURIComponent(id!)}`, { signal }),
    enabled: Boolean(id),
  });
}

export function useCategories() {
  return useQuery({
    queryKey: ["categories"],
    queryFn: ({ signal }) =>
      api<CategoryCount[]>("/books/categories", { signal }),
    staleTime: 5 * 60_000,
  });
}

export function useDownloadLink() {
  return useMutation({
    mutationFn: (id: string) =>
      api<BookFileUrl>(`/books/${encodeURIComponent(id)}/file`),
  });
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export function useSearch(
  q: string,
  mode: SearchMode,
  offset: number,
  limit = 10,
) {
  return useQuery({
    queryKey: ["search", mode, q, offset, limit],
    queryFn: ({ signal }) =>
      api<SearchResponse>(mode === "semantic" ? "/search/dense" : "/search", {
        query: { q, limit, offset },
        signal,
      }),
    enabled: q.trim().length > 0,
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
}

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

export function useIndexStats() {
  return useQuery({
    queryKey: ["indexStats"],
    queryFn: ({ signal }) => api<IndexStats>("/indexing/stats", { signal }),
  });
}

export function useIndexStatuses(bookIds: string[], poll = false) {
  return useQuery({
    queryKey: ["indexStatuses", bookIds],
    queryFn: ({ signal }) =>
      api<BookIndexStatus[]>("/indexing/status", {
        query: { ids: bookIds.join(",") },
        signal,
      }),
    enabled: bookIds.length > 0,
    // Keep polling while something is still being indexed.
    refetchInterval: (query) => {
      const busy = query.state.data?.some(
        (s) => s.status === "pending" || s.status === "indexing",
      );
      return busy || poll ? 3000 : false;
    },
  });
}

export function useBookIndexStatus(bookId: string | undefined) {
  return useQuery({
    queryKey: ["indexStatus", bookId],
    queryFn: ({ signal }) =>
      api<BookIndexStatus>(`/indexing/${encodeURIComponent(bookId!)}`, {
        signal,
      }),
    enabled: Boolean(bookId),
    refetchInterval: (query) => {
      const s = query.state.data?.status;
      return s === "pending" || s === "indexing" ? 3000 : false;
    },
  });
}

function useInvalidateBooks() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ["books"] });
    void qc.invalidateQueries({ queryKey: ["book"] });
    void qc.invalidateQueries({ queryKey: ["categories"] });
    void qc.invalidateQueries({ queryKey: ["indexStatuses"] });
    void qc.invalidateQueries({ queryKey: ["indexStatus"] });
    void qc.invalidateQueries({ queryKey: ["indexStats"] });
  };
}

export function useUploadBook() {
  const invalidate = useInvalidateBooks();
  return useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append("file", file);
      return api<UploadBookResponse>("/books/upload", { form });
    },
    onSuccess: invalidate,
  });
}

export function useUpdateBook(id: string) {
  const invalidate = useInvalidateBooks();
  return useMutation({
    mutationFn: (patch: BookPatch) =>
      api<Book>(`/books/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: patch,
      }),
    onSuccess: invalidate,
  });
}

export function useDeleteBook() {
  const invalidate = useInvalidateBooks();
  return useMutation({
    mutationFn: (id: string) =>
      api<{ id: string; deleted: boolean }>(
        `/books/${encodeURIComponent(id)}`,
        {
          method: "DELETE",
        },
      ),
    onSuccess: invalidate,
  });
}

export function useReindexBook() {
  const invalidate = useInvalidateBooks();
  return useMutation({
    mutationFn: (id: string) =>
      api<UploadBookResponse>(`/books/${encodeURIComponent(id)}/reindex`, {
        method: "POST",
      }),
    onSuccess: invalidate,
  });
}

export function useFinalizeIndex() {
  const invalidate = useInvalidateBooks();
  return useMutation({
    mutationFn: () => api<IndexStats>("/indexing/finalize", { method: "POST" }),
    onSuccess: invalidate,
  });
}

export function useEmbedBackfill() {
  const invalidate = useInvalidateBooks();
  return useMutation({
    mutationFn: () =>
      api<EmbedResponse>("/indexing/embed", { method: "POST", body: {} }),
    onSuccess: invalidate,
  });
}
