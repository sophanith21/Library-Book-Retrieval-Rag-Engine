import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  useBooks,
  useDeleteBook,
  useIndexStatuses,
  useReindexBook,
} from "../../api/hooks";
import type { BookIndexStatus } from "../../api/types";
import { Cover } from "../../components/Cover";
import {
  ConfirmButton,
  EmptyState,
  ErrorNotice,
  Pagination,
  Spinner,
  StatusBadge,
} from "../../components/ui";
import { formatNumber } from "../../lib/format";

const PAGE_SIZE = 20;

export function AdminBooks() {
  const [filter, setFilter] = useState("");
  const [q, setQ] = useState("");
  const [offset, setOffset] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => {
      setQ(filter.trim());
      setOffset(0);
    }, 300);
    return () => clearTimeout(t);
  }, [filter]);

  const books = useBooks({ q, sort: "newest", limit: PAGE_SIZE, offset });
  const ids = useMemo(
    () => books.data?.items.map((b) => b.id) ?? [],
    [books.data],
  );
  const statuses = useIndexStatuses(ids);
  const statusById = useMemo(
    () =>
      new Map<string, BookIndexStatus>(
        statuses.data?.map((s) => [s.bookId, s]) ?? [],
      ),
    [statuses.data],
  );
  const remove = useDeleteBook();
  const reindex = useReindexBook();
  const busyId =
    (remove.isPending && remove.variables) ||
    (reindex.isPending && reindex.variables);

  return (
    <div className="admin-section">
      <div className="toolbar">
        <input
          type="search"
          className="input"
          placeholder="Filter by title or author"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          aria-label="Filter books"
        />
        <Link to="/admin/upload" className="btn">
          Upload EPUB
        </Link>
      </div>

      {remove.isError && <ErrorNotice error={remove.error} />}
      {reindex.isError && <ErrorNotice error={reindex.error} />}
      {reindex.isSuccess && (
        <p className="notice notice-ok">
          Re-indexing “{reindex.data.book.title}”: {reindex.data.chapterCount}{" "}
          chapters, {formatNumber(reindex.data.chunkCount)} passages queued.
        </p>
      )}

      {books.isPending ? (
        <Spinner label="Loading books" />
      ) : books.isError ? (
        <ErrorNotice error={books.error} onRetry={() => void books.refetch()} />
      ) : books.data.items.length === 0 ? (
        <EmptyState title={q ? "No books match" : "No books yet"}>
          {q ? (
            "Try another filter."
          ) : (
            <Link to="/admin/upload">Upload your first EPUB</Link>
          )}
        </EmptyState>
      ) : (
        <>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Book</th>
                  <th scope="col">Search index</th>
                  <th scope="col" className="num">
                    Passages
                  </th>
                  <th scope="col" className="actions-col">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {books.data.items.map((b) => {
                  const s = statusById.get(b.id);
                  return (
                    <tr key={b.id}>
                      <td>
                        <div className="table-book">
                          <Cover title={b.title} url={b.coverUrl} size="sm" />
                          <div>
                            <Link
                              to={`/books/${encodeURIComponent(b.id)}`}
                              className="table-title"
                            >
                              {b.title}
                            </Link>
                            <div className="muted small">{b.author}</div>
                            <code className="small muted">{b.id}</code>
                          </div>
                        </div>
                      </td>
                      <td>
                        {s ? (
                          <>
                            <StatusBadge
                              status={s.status}
                              title={s.error ?? undefined}
                            />
                            {s.status === "failed" && s.error && (
                              <div className="small error-text">{s.error}</div>
                            )}
                          </>
                        ) : (
                          <span className="muted small">…</span>
                        )}
                      </td>
                      <td className="num">
                        {s ? formatNumber(s.chunkCount) : "—"}
                      </td>
                      <td className="actions-col">
                        <div className="row-actions">
                          <Link
                            to={`/admin/books/${encodeURIComponent(b.id)}`}
                            className="btn btn-ghost btn-small"
                          >
                            Edit
                          </Link>
                          <button
                            type="button"
                            className="btn btn-ghost btn-small"
                            disabled={!b.hasFile || Boolean(busyId)}
                            title={
                              b.hasFile
                                ? "Re-parse the stored EPUB and index it again"
                                : "No EPUB stored"
                            }
                            onClick={() => reindex.mutate(b.id)}
                          >
                            {reindex.isPending && reindex.variables === b.id
                              ? "Queuing…"
                              : "Re-index"}
                          </button>
                          <ConfirmButton
                            className="btn btn-danger btn-small"
                            confirmLabel="Confirm delete"
                            disabled={Boolean(busyId)}
                            onConfirm={() => remove.mutate(b.id)}
                          >
                            {remove.isPending && remove.variables === b.id
                              ? "Deleting…"
                              : "Delete"}
                          </ConfirmButton>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pagination
            total={books.data.total}
            limit={PAGE_SIZE}
            offset={offset}
            onChange={setOffset}
          />
        </>
      )}
    </div>
  );
}
