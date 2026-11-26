import { Link, useParams } from "react-router-dom";
import { useBook, useDownloadLink } from "../api/hooks";
import { useAuth } from "../auth/context";
import { Cover } from "../components/Cover";
import {
  CategoryChips,
  EmptyState,
  ErrorNotice,
  Spinner,
} from "../components/ui";
import { ApiError } from "../api/client";

export function BookDetail() {
  const { id } = useParams();
  const book = useBook(id);
  const { user } = useAuth();
  const download = useDownloadLink();

  if (book.isPending)
    return (
      <div className="page">
        <Spinner label="Loading book" />
      </div>
    );
  if (book.isError) {
    return (
      <div className="page">
        {book.error instanceof ApiError && book.error.status === 404 ? (
          <EmptyState title="Book not found">
            It may have been removed. <Link to="/">Back to the catalogue</Link>
          </EmptyState>
        ) : (
          <ErrorNotice error={book.error} onRetry={() => void book.refetch()} />
        )}
      </div>
    );
  }

  const b = book.data;
  const onDownload = () => {
    download.mutate(b.id, {
      onSuccess: (link) => {
        window.location.href = link.url;
      },
    });
  };

  return (
    <div className="page">
      <Link to="/" className="back-link">
        ← Catalogue
      </Link>
      <article className="book-detail">
        <Cover title={b.title} author={b.author} url={b.coverUrl} size="lg" />
        <div className="book-detail-body">
          <h1>{b.title}</h1>
          <p className="book-detail-author">{b.author}</p>
          <dl className="facts">
            {b.publishedDate && (
              <>
                <dt>Date</dt>
                <dd>{b.publishedDate}</dd>
              </>
            )}
            <dt>Added</dt>
            <dd>{new Date(b.createdAt).toLocaleDateString()}</dd>
          </dl>
          <CategoryChips categories={b.categories} max={8} />

          {b.description && <p className="description">{b.description}</p>}

          <div className="actions">
            {b.hasFile ? (
              user ? (
                <button
                  type="button"
                  className="btn"
                  onClick={onDownload}
                  disabled={download.isPending}
                >
                  {download.isPending ? "Preparing…" : "Download EPUB"}
                </button>
              ) : (
                <Link
                  to="/login"
                  state={{ from: `/books/${b.id}` }}
                  className="btn"
                >
                  Sign in to download
                </Link>
              )
            ) : (
              <span className="muted small">
                No EPUB file is stored for this book.
              </span>
            )}
            {user?.role === "admin" && (
              <Link
                to={`/admin/books/${encodeURIComponent(b.id)}`}
                className="btn btn-ghost"
              >
                Edit in admin
              </Link>
            )}
          </div>
          {download.isError && <ErrorNotice error={download.error} />}
        </div>
      </article>
    </div>
  );
}
