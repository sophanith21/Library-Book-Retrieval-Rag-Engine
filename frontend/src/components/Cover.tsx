import { useState } from "react";

// Muted cloth-binding colours for books without a cover image.
const BINDINGS = [
  "#5b3a29",
  "#2f4f4f",
  "#3d405b",
  "#6b4226",
  "#40514e",
  "#5c3c55",
  "#344e41",
  "#7a4a3a",
];

function hash(text: string) {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function Cover({
  title,
  author,
  url,
  size = "md",
}: {
  title: string;
  author?: string | null;
  url: string | null;
  size?: "sm" | "md" | "lg";
}) {
  const [failed, setFailed] = useState(false);
  if (url && !failed) {
    return (
      <img
        className={`cover cover-${size}`}
        src={url}
        alt={`Cover of ${title}`}
        loading="lazy"
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <div
      className={`cover cover-${size} cover-generated`}
      style={{ background: BINDINGS[hash(title) % BINDINGS.length] }}
      role="img"
      aria-label={`Cover of ${title}`}
    >
      <span className="cover-title">{title}</span>
      {author && <span className="cover-author">{author}</span>}
    </div>
  );
}
