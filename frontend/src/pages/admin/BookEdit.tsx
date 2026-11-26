import { useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  useBook,
  useBookIndexStatus,
  useDeleteBook,
  useReindexBook,
  useUpdateBook,
} from "../../api/hooks";
import type { Book } from "../../api/types";
import { Cover } from "../../components/Cover";
import {
  ConfirmButton,
  ErrorNotice,
  Spinner,
  StatusBadge,
} from "../../components/ui";
import { formatDate, formatNumber } from "../../lib/format";

interface FormState {
  title: string;
  author: string;
  categories: string;
  publishedDate: string;
  description: string;
}

const toForm = (b: Book): FormState => ({
  title: b.title,
  author: b.author,
  categories: b.categories.join(", "),
  publishedDate: b.publishedDate ?? "",
  description: b.description ?? "",
});

export function BookEdit() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const book = useBook(id);
  const status = useBookIndexStatus(id);
  const update = useUpdateBook(id);
  const reindex = useReindexBook();
  const remove = useDeleteBook();

  if (book.isPending) return <Spinner label="Loading book" />;
  if (book.isError) {
    return (
      <ErrorNotice error={book.error} onRetry={() => void book.refetch()} />
    );
  }
  const b = book.data;

  return (
    <div className="admin-section">
      <Link to="/admin/books" className="back-link">
        ← All books
      </Link>
      <div className="edit-layout">
        {/* Keyed on updatedAt so the form resets to the saved values after a save. */}
        <DetailsForm key={b.updatedAt} book={b} update={update} />

        <aside className="edit-side">
          <div className="panel">
            <Cover
              title={b.title}
              author={b.author}
              url={b.coverUrl}
              size="md"
            />
            <dl className="facts">
              <dt>ID</dt>
              <dd>
                <code>{b.id}</code>
              </dd>
              <dt>EPUB</dt>
              <dd>{b.hasFile ? "Stored" : "None"}</dd>
              <dt>Added</dt>
              <dd>{formatDate(b.createdAt)}</dd>
            </dl>
          </div>

          <div className="panel">
            <h2>Search index</h2>
            {status.data ? (
              <>
                <StatusBadge status={status.data.status} />
                <dl className="facts">
                  <dt>Passages</dt>
                  <dd>{formatNumber(status.data.chunkCount)}</dd>
                  <dt>Indexed words</dt>
                  <dd>{formatNumber(status.data.tokenCount)}</dd>
                  <dt>Indexed</dt>
                  <dd>{formatDate(status.data.indexedAt)}</dd>
                </dl>
                {status.data.error && (
                  <p className="error-text small">{status.data.error}</p>
                )}
              </>
            ) : status.isError ? (
              <ErrorNotice error={status.error} />
            ) : (
              <Spinner />
            )}
            <button
              type="button"
              className="btn btn-ghost btn-block"
              disabled={!b.hasFile || reindex.isPending}
              onClick={() => reindex.mutate(b.id)}
            >
              {reindex.isPending ? "Queuing…" : "Re-index from EPUB"}
            </button>
            {reindex.isSuccess && (
              <p className="notice notice-ok small">
                Queued {formatNumber(reindex.data.chunkCount)} passages.
              </p>
            )}
            {reindex.isError && <ErrorNotice error={reindex.error} />}
          </div>

          <div className="panel panel-danger">
            <h2>Delete book</h2>
            <p className="muted small">
              Removes the book, its EPUB and cover, and its passages from
              search.
            </p>
            <ConfirmButton
              className="btn btn-danger btn-block"
              confirmLabel="Click again to delete permanently"
              disabled={remove.isPending}
              onConfirm={() =>
                remove.mutate(b.id, {
                  onSuccess: () => navigate("/admin/books", { replace: true }),
                })
              }
            >
              {remove.isPending ? "Deleting…" : "Delete this book"}
            </ConfirmButton>
            {remove.isError && <ErrorNotice error={remove.error} />}
          </div>
        </aside>
      </div>
    </div>
  );
}

function DetailsForm({
  book: b,
  update,
}: {
  book: Book;
  update: ReturnType<typeof useUpdateBook>;
}) {
  const [form, setForm] = useState<FormState>(() => toForm(b));
  const dirty = JSON.stringify(form) !== JSON.stringify(toForm(b));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    update.mutate({
      title: form.title,
      author: form.author,
      categories: form.categories
        .split(",")
        .map((c) => c.trim())
        .filter(Boolean),
      publishedDate: form.publishedDate.trim() || null,
      description: form.description.trim() || null,
    });
  };
  const field = (key: keyof FormState) => ({
    value: form[key],
    onChange: (e: { target: { value: string } }) =>
      setForm({ ...form, [key]: e.target.value }),
  });

  return (
    <form className="panel edit-form" onSubmit={submit}>
      <h2>Details</h2>
      <label className="field">
        <span>Title</span>
        <input className="input" required {...field("title")} />
      </label>
      <label className="field">
        <span>Author</span>
        <input className="input" {...field("author")} />
      </label>
      <label className="field">
        <span>Categories</span>
        <input
          className="input"
          placeholder="Fiction, Sea stories"
          {...field("categories")}
        />
        <small className="muted">Separate with commas.</small>
      </label>
      <label className="field">
        <span>Date</span>
        <input
          className="input"
          placeholder="1851"
          {...field("publishedDate")}
        />
      </label>
      <label className="field">
        <span>Description</span>
        <textarea className="input" rows={6} {...field("description")} />
      </label>
      <p className="muted small">
        Search results show the title and author the book had when it was last
        indexed. Re-index after renaming to update them.
      </p>
      {update.isError && <ErrorNotice error={update.error} />}
      {update.isSuccess && !dirty && <p className="notice notice-ok">Saved.</p>}
      <div className="actions">
        <button
          type="submit"
          className="btn"
          disabled={!dirty || !form.title.trim() || update.isPending}
        >
          {update.isPending ? "Saving…" : "Save changes"}
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          disabled={!dirty}
          onClick={() => setForm(toForm(b))}
        >
          Discard
        </button>
      </div>
    </form>
  );
}
