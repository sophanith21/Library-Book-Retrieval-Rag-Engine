import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { IndexState, Snippet } from "../api/types";

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <div className="spinner" role="status">
      <span className="spinner-dot" aria-hidden="true" />
      <span>{label}…</span>
    </div>
  );
}

export function ErrorNotice({
  error,
  onRetry,
}: {
  error: unknown;
  onRetry?: () => void;
}) {
  const message =
    error instanceof Error ? error.message : "Something went wrong.";
  return (
    <div className="notice notice-error" role="alert">
      <span>{message}</span>
      {onRetry && (
        <button type="button" className="btn btn-small" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

export function EmptyState({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children && <div className="muted">{children}</div>}
    </div>
  );
}

/** Snippet text with the server-computed highlight spans wrapped in <mark>. */
export function SnippetText({ snippet }: { snippet: Snippet }) {
  const parts: ReactNode[] = [];
  let cursor = 0;
  const spans = [...snippet.highlights].sort((a, b) => a.start - b.start);
  spans.forEach((span, i) => {
    if (span.start < cursor) return;
    if (span.start > cursor) parts.push(snippet.text.slice(cursor, span.start));
    parts.push(<mark key={i}>{snippet.text.slice(span.start, span.end)}</mark>);
    cursor = span.end;
  });
  if (cursor < snippet.text.length) parts.push(snippet.text.slice(cursor));
  return <p className="snippet">{parts}</p>;
}

export function Pagination({
  total,
  limit,
  offset,
  onChange,
}: {
  total: number;
  limit: number;
  offset: number;
  onChange: (offset: number) => void;
}) {
  if (total <= limit) return null;
  const page = Math.floor(offset / limit) + 1;
  const pages = Math.ceil(total / limit);
  return (
    <nav className="pagination" aria-label="Pagination">
      <button
        type="button"
        className="btn btn-ghost"
        disabled={page <= 1}
        onClick={() => onChange(Math.max(0, offset - limit))}
      >
        ← Previous
      </button>
      <span className="muted">
        Page {page} of {pages}
      </span>
      <button
        type="button"
        className="btn btn-ghost"
        disabled={page >= pages}
        onClick={() => onChange(offset + limit)}
      >
        Next →
      </button>
    </nav>
  );
}

const STATUS_LABELS: Record<IndexState, string> = {
  done: "Indexed",
  indexing: "Indexing",
  pending: "Queued",
  failed: "Failed",
  not_found: "Not indexed",
};

export function StatusBadge({
  status,
  title,
}: {
  status: IndexState;
  title?: string;
}) {
  return (
    <span className={`badge badge-${status}`} title={title}>
      {STATUS_LABELS[status]}
    </span>
  );
}

/**
 * Two-step confirmation without a modal: the first click arms the button,
 * a second click within a few seconds runs the action.
 */
export function ConfirmButton({
  children,
  confirmLabel = "Click again to confirm",
  onConfirm,
  disabled,
  className = "btn btn-danger",
}: {
  children: ReactNode;
  confirmLabel?: string;
  onConfirm: () => void;
  disabled?: boolean;
  className?: string;
}) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <button
      type="button"
      className={`${className}${armed ? " armed" : ""}`}
      disabled={disabled}
      onClick={() => {
        if (armed) {
          setArmed(false);
          onConfirm();
        } else {
          setArmed(true);
        }
      }}
    >
      {armed ? confirmLabel : children}
    </button>
  );
}

export function CategoryChips({
  categories,
  max = 3,
}: {
  categories: string[];
  max?: number;
}) {
  if (categories.length === 0) return null;
  const shown = categories.slice(0, max);
  return (
    <ul className="chips">
      {shown.map((c) => (
        <li key={c}>
          <Link className="chip" to={`/?category=${encodeURIComponent(c)}`}>
            {c}
          </Link>
        </li>
      ))}
      {categories.length > max && (
        <li className="chip chip-more">+{categories.length - max}</li>
      )}
    </ul>
  );
}
