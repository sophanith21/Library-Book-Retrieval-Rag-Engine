import { Link } from "react-router-dom";
import type { Book } from "../api/types";
import { Cover } from "./Cover";

export function BookCard({ book }: { book: Book }) {
  return (
    <article className="book-card">
      <Link
        to={`/books/${encodeURIComponent(book.id)}`}
        className="book-card-link"
      >
        <Cover title={book.title} author={book.author} url={book.coverUrl} />
        <div className="book-card-meta">
          <h3 className="book-card-title">{book.title}</h3>
          <p className="book-card-author">{book.author}</p>
        </div>
      </Link>
    </article>
  );
}
