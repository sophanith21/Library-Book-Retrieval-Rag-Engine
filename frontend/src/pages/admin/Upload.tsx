import { useRef, useState, type DragEvent } from "react";
import { Link } from "react-router-dom";
import { useIndexStatuses, useUploadBook } from "../../api/hooks";
import type { UploadBookResponse } from "../../api/types";
import { StatusBadge } from "../../components/ui";
import { formatNumber } from "../../lib/format";
import { ApiError } from "../../api/client";

const MAX_BYTES = 50 * 1024 * 1024;

type Item =
  | { key: string; file: File; state: "waiting" | "uploading" }
  | { key: string; file: File; state: "done"; result: UploadBookResponse }
  | { key: string; file: File; state: "error"; message: string };

export function Upload() {
  const [items, setItems] = useState<Item[]>([]);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const upload = useUploadBook();

  const doneIds = items.flatMap((i) =>
    i.state === "done" ? [i.result.book.id] : [],
  );
  // Poll index status for uploaded books until indexing finishes.
  const statuses = useIndexStatuses(doneIds, doneIds.length > 0);
  const statusById = new Map(statuses.data?.map((s) => [s.bookId, s]) ?? []);

  const setItem = (key: string, next: Item) =>
    setItems((list) => list.map((i) => (i.key === key ? next : i)));

  // Uploads run one at a time so a batch doesn't flood the parser.
  const runQueue = async (queue: Item[]) => {
    for (const item of queue) {
      setItem(item.key, { ...item, state: "uploading" });
      try {
        const result = await upload.mutateAsync(item.file);
        setItem(item.key, {
          key: item.key,
          file: item.file,
          state: "done",
          result,
        });
      } catch (err) {
        setItem(item.key, {
          key: item.key,
          file: item.file,
          state: "error",
          message:
            err instanceof ApiError || err instanceof Error
              ? err.message
              : "Upload failed",
        });
      }
    }
  };

  const addFiles = (files: FileList | null) => {
    if (!files?.length) return;
    const added: Item[] = [...files].map((file, i) => {
      const key = `${Date.now()}-${i}-${file.name}`;
      if (!/\.epub$/i.test(file.name)) {
        return { key, file, state: "error", message: "Not an .epub file" };
      }
      if (file.size > MAX_BYTES) {
        return { key, file, state: "error", message: "Larger than 50 MB" };
      }
      return { key, file, state: "waiting" };
    });
    setItems((list) => [...added, ...list]);
    void runQueue(added.filter((i) => i.state === "waiting"));
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    addFiles(e.dataTransfer.files);
  };

  return (
    <div className="admin-section">
      <div
        className={`dropzone${dragging ? " dragging" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <p className="dropzone-title">Drop EPUB files here</p>
        <p className="muted small">
          Each book is stored, its title, author, subjects and cover are read
          from the file, and it's queued for keyword and semantic indexing.
          Uploading a file with the same name again replaces that book.
        </p>
        <button
          type="button"
          className="btn"
          onClick={() => input.current?.click()}
        >
          Choose files
        </button>
        <input
          ref={input}
          type="file"
          accept=".epub,application/epub+zip"
          multiple
          hidden
          onChange={(e) => {
            addFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {items.length > 0 && (
        <ul className="upload-list">
          {items.map((item) => (
            <li key={item.key} className={`upload-item upload-${item.state}`}>
              <div className="upload-name">
                <strong>
                  {item.state === "done"
                    ? item.result.book.title
                    : item.file.name}
                </strong>
                <span className="muted small">
                  {item.state === "done"
                    ? `${item.result.book.author} · ${item.result.chapterCount} chapters · ${formatNumber(item.result.chunkCount)} passages`
                    : `${(item.file.size / 1024 / 1024).toFixed(1)} MB`}
                </span>
              </div>
              <div className="upload-state">
                {item.state === "waiting" && (
                  <span className="muted small">Waiting…</span>
                )}
                {item.state === "uploading" && (
                  <span className="muted small">Uploading and parsing…</span>
                )}
                {item.state === "error" && (
                  <span className="error-text small">{item.message}</span>
                )}
                {item.state === "done" && (
                  <>
                    {item.result.indexingQueued ? (
                      <StatusBadge
                        status={
                          statusById.get(item.result.book.id)?.status ??
                          "pending"
                        }
                      />
                    ) : (
                      <span className="error-text small">
                        Saved, but the indexing queue is unavailable. Use
                        Re-index later.
                      </span>
                    )}
                    <Link
                      to={`/admin/books/${encodeURIComponent(item.result.book.id)}`}
                      className="btn btn-ghost btn-small"
                    >
                      Edit
                    </Link>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
