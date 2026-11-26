import { Link, useSearchParams } from "react-router-dom";
import { useSearch } from "../api/hooks";
import type { SearchMode } from "../api/types";
import {
  EmptyState,
  ErrorNotice,
  Pagination,
  Spinner,
  SnippetText,
} from "../components/ui";
import { formatNumber } from "../lib/format";

const PAGE_SIZE = 10;

const MODES: { id: SearchMode; label: string; hint: string }[] = [
  {
    id: "keyword",
    label: "Exact words",
    hint: "BM25 keyword match. Best for names and phrases.",
  },
  {
    id: "semantic",
    label: "By meaning",
    hint: "Vector search. Finds passages about the idea, even with other words.",
  },
];

export function Search() {
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const mode: SearchMode =
    params.get("mode") === "semantic" ? "semantic" : "keyword";
  const offset = Number(params.get("offset") ?? 0) || 0;
  const search = useSearch(q, mode, offset, PAGE_SIZE);

  const set = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    setParams(next);
  };

  return (
    <div className="page page-narrow">
      <header className="search-header">
        <h1>{q ? <>Results for “{q}”</> : "Search the library"}</h1>
        <div className="segmented" role="tablist" aria-label="Search mode">
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              role="tab"
              aria-selected={mode === m.id}
              className={mode === m.id ? "active" : ""}
              title={m.hint}
              onClick={() =>
                set({ mode: m.id === "keyword" ? null : m.id, offset: null })
              }
            >
              {m.label}
            </button>
          ))}
        </div>
        <p className="muted small">{MODES.find((m) => m.id === mode)?.hint}</p>
      </header>

      {!q ? (
        <EmptyState title="Type a question or a phrase in the search box">
          Try “white whale”, “a letter from home”, or “what is courage?”
        </EmptyState>
      ) : search.isPending ? (
        <Spinner label="Searching" />
      ) : search.isError ? (
        <ErrorNotice
          error={search.error}
          onRetry={() => void search.refetch()}
        />
      ) : search.data.results.length === 0 ? (
        <EmptyState title="No matching passages">
          {mode === "keyword" ? (
            <>
              No book contains these words.{" "}
              <button
                type="button"
                className="link"
                onClick={() => set({ mode: "semantic", offset: null })}
              >
                Search by meaning instead
              </button>
            </>
          ) : (
            "Nothing close enough was found. Try describing it differently."
          )}
        </EmptyState>
      ) : (
        <>
          <p className="muted small result-count">
            {formatNumber(search.data.total)}{" "}
            {search.data.total === 1 ? "book" : "books"} · {search.data.tookMs}{" "}
            ms
          </p>
          <ol className={`results${search.isPlaceholderData ? " stale" : ""}`}>
            {search.data.results.map((hit) => (
              <li
                key={`${hit.bookId}-${hit.chapterNo}-${hit.chunkNo}`}
                className="result"
              >
                <div className="result-head">
                  <Link
                    to={`/books/${encodeURIComponent(hit.bookId)}`}
                    className="result-title"
                  >
                    {hit.title}
                  </Link>
                  {hit.author && <span className="muted"> · {hit.author}</span>}
                </div>
                <SnippetText snippet={hit.snippet} />
                <div className="result-meta muted small">
                  Chapter {hit.chapterNo}
                  {mode === "keyword" ? (
                    hit.matchedTerms !== undefined && (
                      <>
                        {" "}
                        · {hit.matchedTerms} of {search.data.terms?.length ?? 0}{" "}
                        search words
                      </>
                    )
                  ) : (
                    <> · similarity {hit.score.toFixed(2)}</>
                  )}
                </div>
              </li>
            ))}
          </ol>
          <Pagination
            total={search.data.total}
            limit={PAGE_SIZE}
            offset={offset}
            onChange={(o) => {
              set({ offset: o ? String(o) : null });
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
          />
        </>
      )}
    </div>
  );
}
