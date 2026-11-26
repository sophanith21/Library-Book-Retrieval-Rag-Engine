import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useBooks, useCategories } from "../api/hooks";
import type { BookSort } from "../api/types";
import { BookCard } from "../components/BookCard";
import { EmptyState, ErrorNotice, Pagination, Spinner } from "../components/ui";
import { formatNumber } from "../lib/format";

const PAGE_SIZE = 24;

export function Home() {
  const [params, setParams] = useSearchParams();
  const category = params.get("category") ?? "";
  const sort = (params.get("sort") as BookSort | null) ?? "title";
  const offset = Number(params.get("offset") ?? 0) || 0;
  const filterParam = params.get("filter") ?? "";
  const [filter, setFilter] = useState(filterParam);
  // Follow the URL when it changes from outside (back/forward, category links).
  const [shownParam, setShownParam] = useState(filterParam);
  if (shownParam !== filterParam) {
    setShownParam(filterParam);
    setFilter(filterParam);
  }

  const update = useCallback(
    (changes: Record<string, string | null>) =>
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [k, v] of Object.entries(changes)) {
            if (v === null || v === "") next.delete(k);
            else next.set(k, v);
          }
          return next;
        },
        { replace: true },
      ),
    [setParams],
  );

  // Debounce the title/author filter into the URL.
  useEffect(() => {
    if (filter === filterParam) return;
    const t = setTimeout(
      () => update({ filter: filter || null, offset: null }),
      300,
    );
    return () => clearTimeout(t);
  }, [filter, filterParam, update]);

  const books = useBooks({
    q: filterParam,
    category,
    sort,
    limit: PAGE_SIZE,
    offset,
  });
  const categories = useCategories();

  return (
    <div className="page">
      <section className="hero">
        <h1>Find the passage, not just the book.</h1>
        <p className="lede">
          Search the full text of every book in the collection, by exact words
          or by what you mean.
        </p>
      </section>

      <div className="browse">
        <aside className="browse-sidebar" aria-label="Categories">
          <h2 className="sidebar-title">Categories</h2>
          <ul className="category-list">
            <li>
              <button
                type="button"
                className={!category ? "active" : ""}
                onClick={() => update({ category: null, offset: null })}
              >
                All books
              </button>
            </li>
            {categories.data?.map((c) => (
              <li key={c.name}>
                <button
                  type="button"
                  className={category === c.name ? "active" : ""}
                  onClick={() => update({ category: c.name, offset: null })}
                >
                  <span>{c.name}</span>
                  <span className="count">{c.count}</span>
                </button>
              </li>
            ))}
          </ul>
          {categories.data?.length === 0 && (
            <p className="muted small">No categories yet.</p>
          )}
        </aside>

        <section className="browse-main">
          <div className="toolbar">
            <input
              type="search"
              className="input"
              placeholder="Filter by title or author"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              aria-label="Filter by title or author"
            />
            <label className="select-label">
              Sort
              <select
                className="input"
                value={sort}
                onChange={(e) => update({ sort: e.target.value, offset: null })}
              >
                <option value="title">Title</option>
                <option value="author">Author</option>
                <option value="newest">Recently added</option>
              </select>
            </label>
          </div>

          {books.data && (
            <p className="muted small result-count">
              {formatNumber(books.data.total)}{" "}
              {books.data.total === 1 ? "book" : "books"}
              {category && (
                <>
                  {" "}
                  in <strong>{category}</strong>
                </>
              )}
            </p>
          )}

          {books.isPending ? (
            <Spinner label="Loading books" />
          ) : books.isError ? (
            <ErrorNotice
              error={books.error}
              onRetry={() => void books.refetch()}
            />
          ) : books.data.items.length === 0 ? (
            <EmptyState title="No books found">
              {filterParam || category
                ? "Try a different filter or category."
                : "The collection is empty. An admin can upload EPUBs from the admin area."}
            </EmptyState>
          ) : (
            <>
              <div
                className={`book-grid${books.isPlaceholderData ? " stale" : ""}`}
              >
                {books.data.items.map((b) => (
                  <BookCard key={b.id} book={b} />
                ))}
              </div>
              <Pagination
                total={books.data.total}
                limit={PAGE_SIZE}
                offset={offset}
                onChange={(o) => {
                  update({ offset: o ? String(o) : null });
                  window.scrollTo({ top: 0, behavior: "smooth" });
                }}
              />
            </>
          )}
        </section>
      </div>
    </div>
  );
}
