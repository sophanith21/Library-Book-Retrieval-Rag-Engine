#!/usr/bin/env python3
"""
EPUB ingestion pipeline for the Library Book Retrieval RAG Engine (LBRE).

One file, one book at a time:

    parse (ebooklib + BeautifulSoup)  ->  chunk  ->  save to JSON  ->  upload to SeaweedFS  ->  API Gateway

Parsed book data is saved to data/parsed_json/<book_id>.json.

Usage (run from anywhere):
    python ingest2.py --file book.epub --save-json     # parse 1 book & save JSON (no gateway)
    python ingest2.py --dir data/ebooks --save-json    # parse all books & save JSON (no gateway)
    python ingest2.py --dir data/ebooks --limit 10 --save-json # first 10 books to JSON
    python ingest2.py --dir data/ebooks --dry-run      # parse + chunk + stats only (no file, no network)
    python ingest2.py --dir data/ebooks                # full run (uploads to SeaweedFS + API Gateway)
    python ingest2.py --file book.epub --force         # re-ingest one book

Environment variables (same names as the team's original script):
    S3_ENDPOINT  (default http://localhost:8333)
    S3_BUCKET    (default books)
    S3_ACCESS_KEY, S3_SECRET_KEY   (if set, uploads are signed S3 requests via boto3)
    API_URL      (default http://localhost:3000)

Install:
    pip install ebooklib beautifulsoup4 lxml requests boto3
"""

import argparse
import hashlib
import json
import mimetypes
import os
import re
import sys
import warnings
from pathlib import Path

import requests
from bs4 import BeautifulSoup, XMLParsedAsHTMLWarning
from ebooklib import epub, ITEM_DOCUMENT, ITEM_COVER, ITEM_IMAGE

warnings.filterwarnings("ignore", category=XMLParsedAsHTMLWarning)  # EPUB pages are XHTML; harmless


def _load_env():
    """Load variables from .env into os.environ if not already set."""
    candidates = [
        Path(".env"),
        Path(__file__).resolve().parent / ".env",
    ]
    for env_path in candidates:
        if env_path.is_file():
            with open(env_path, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line or line.startswith("#") or "=" not in line:
                        continue
                    key, val = line.split("=", 1)
                    key = key.strip()
                    val = val.strip().strip("'\"")
                    if key not in os.environ:
                        os.environ[key] = val
            break


_load_env()

# --------------------------------------------------------------------------
# Settings
# --------------------------------------------------------------------------
S3_ENDPOINT = os.getenv("S3_ENDPOINT", "http://localhost:8333")
S3_BUCKET = os.getenv("S3_BUCKET", "books")
S3_ACCESS_KEY = os.getenv("S3_ACCESS_KEY")   # e.g. devaccess
S3_SECRET_KEY = os.getenv("S3_SECRET_KEY")   # e.g. devsecret
API_URL = os.getenv("API_URL", "http://localhost:3000")

MAX_WORDS = 150           # target chunk size (words, a rough proxy for tokens)
OVERLAP_WORDS = 30        # paragraph-level overlap between neighbouring chunks
MIN_CHAPTER_WORDS = 100     # 0 = only skip empty documents; raise it to drop short front matter
TINY_CHUNK_WORDS = 30     # only used for the stats printout

FAILED_LOG = Path("failed.log")
PARSED_JSON_DIR = Path("data/parsed_json")

BLOCK_TAGS = ["h1", "h2", "h3", "h4", "h5", "h6",
              "p", "li", "blockquote", "td", "th", "pre", "figcaption"]
HEADING_TAGS = ["h1", "h2", "h3", "h4", "h5", "h6"]


# --------------------------------------------------------------------------
# 1. Parse
# --------------------------------------------------------------------------
# def generate_book_id(file_path):
#     """Stable ID from the file's SHA-256 hash (same bytes -> same ID)."""
#     sha256 = hashlib.sha256()
#     with open(file_path, "rb") as f:
#         for block in iter(lambda: f.read(1024 * 1024), b""):
#             sha256.update(block)
#     return sha256.hexdigest()
def generate_book_id(file_path):
    return Path(file_path).stem


def extract_content(doc):
    """Parse one XHTML document once; return (title, text)."""
    soup = BeautifulSoup(doc.get_content(), "lxml")

    for el in soup(["script", "style", "nav"]):
        el.decompose()

    heading = soup.find(HEADING_TAGS)
    title = heading.get_text(" ", strip=True) if heading else "Untitled Section"

    # Keep only the innermost block so nested tags (<li><p>) don't duplicate text
    parts = []
    for block in soup.find_all(BLOCK_TAGS):
        if block.find(BLOCK_TAGS):
            continue
        text = block.get_text(" ", strip=True)
        if text:
            parts.append(text)

    return title, "\n\n".join(parts)


def extract_cover(book):
    """Return (bytes, content_type, extension) for the cover image, or None."""
    item = next(iter(book.get_items_of_type(ITEM_COVER)), None)

    if item is None:
        meta = book.get_metadata("OPF", "cover")
        if meta:
            item = book.get_item_with_id((meta[0][1] or {}).get("content"))

    if item is None:
        for img in book.get_items_of_type(ITEM_IMAGE):
            if "cover" in img.get_name().lower():
                item = img
                break

    if item is None:
        return None

    content_type = (
        getattr(item, "media_type", None)
        or mimetypes.guess_type(item.get_name())[0]
        or ""
    )
    if not content_type.startswith("image/"):
        return None  # e.g. the cover *page* (XHTML), not an actual image

    ext = Path(item.get_name()).suffix or mimetypes.guess_extension(content_type) or ".jpg"
    return item.get_content(), content_type, ext


def parse_epub(file_path, book_id):
    """Parse one EPUB into a dict: metadata, chapters (title + text), cover."""
    book = epub.read_epub(str(file_path), options={"ignore_ncx": True})

    title_data = book.get_metadata("DC", "title")
    author_data = book.get_metadata("DC", "creator")
    subject_data = book.get_metadata("DC", "subject")
    date_data = book.get_metadata("DC", "date")

    title = title_data[0][0] if title_data else file_path.stem
    author = author_data[0][0] if author_data else "Unknown"
    category = [item[0] for item in subject_data] if subject_data else []
    date = date_data[0][0] if date_data else None

    items = {
        item.get_id(): item
        for item in book.get_items_of_type(ITEM_DOCUMENT)
    }

    chapters = []
    seen = set()

    for idref, _linear in book.spine:          # follow the real reading order
        doc = items.get(idref)
        if doc is None or idref in seen:
            continue
        seen.add(idref)

        chapter_title, text = extract_content(doc)
        if not text or len(text) < MIN_CHAPTER_WORDS:
            continue

        chapters.append({"chapter_title": chapter_title, "text": text})

    return {
        "doc_id": book_id,
        "title": title,
        "author": author,
        "category": category,
        "date": date,
        "cover": extract_cover(book),
        "chapters": chapters,
    }


# --------------------------------------------------------------------------
# 2. Chunk
# --------------------------------------------------------------------------
def split_long_paragraph(paragraph, max_words):
    """Split an oversized paragraph on sentence boundaries."""
    sentences = re.split(r"(?<=[.!?])\s+", paragraph)
    pieces, current, count = [], [], 0
    for sentence in sentences:
        n = len(sentence.split())
        if current and count + n > max_words:
            pieces.append(" ".join(current))
            current, count = [], 0
        current.append(sentence)
        count += n
    if current:
        pieces.append(" ".join(current))
    return pieces


def chunk_text(text, max_words=MAX_WORDS, overlap_words=OVERLAP_WORDS):
    """Pack paragraphs into chunks with a small paragraph-level overlap."""
    paragraphs = []
    for p in text.split("\n\n"):
        p = p.strip()
        if not p:
            continue
        if len(p.split()) > max_words:
            paragraphs.extend(split_long_paragraph(p, max_words))
        else:
            paragraphs.append(p)

    chunks, current, count = [], [], 0
    for p in paragraphs:
        n = len(p.split())
        if current and count + n > max_words:
            chunks.append("\n\n".join(current))

            # carry the last paragraphs into the next chunk as overlap
            carry, carry_count = [], 0
            for prev in reversed(current):
                w = len(prev.split())
                if carry_count + w > overlap_words:
                    break
                carry.insert(0, prev)
                carry_count += w
            current, count = carry, carry_count

        current.append(p)
        count += n

    if current:
        chunks.append("\n\n".join(current))
    return chunks


def chunk_book(book):
    """Return chapters in the API shape: [{chapter_no, chunks: [str, ...]}]."""
    chapters = []
    for ch in book["chapters"]:
        pieces = chunk_text(ch["text"])
        if pieces:
            chapters.append({"chapter_no": len(chapters) + 1, "chunks": pieces})
    return chapters


def summarize(book, chapters):
    """Quick stats so you can sanity-check a book (replaces the old inspect cell)."""
    sizes = [len(c.split()) for ch in chapters for c in ch["chunks"]]
    return {
        "chapters": len(chapters),
        "chunks": len(sizes),
        "min": min(sizes),
        "avg": sum(sizes) // len(sizes),
        "max": max(sizes),
        "tiny": sum(s < TINY_CHUNK_WORDS for s in sizes),
        "cover": book["cover"] is not None,
    }


def save_to_json(book, chapters=None, output_dir=PARSED_JSON_DIR, file_key=None, cover_url=None, stats=None):
    """Save parsed and chunked book data to a JSON file in output_dir."""
    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)

    book_id = book.get("doc_id") or book.get("id") or "unknown"
    out_file = output_path / f"{book_id}.json"

    if chapters is None:
        if "chapters" in book and book["chapters"] and "chunks" in book["chapters"][0]:
            chunked = book["chapters"]
            raw = []
        else:
            try:
                chunked = chunk_book(book)
            except Exception:
                chunked = []
            raw = book.get("chapters", [])
    else:
        chunked = chapters
        raw = book.get("chapters", [])

    data = {
        "id": book_id,
        "bookId": book_id,
        "title": book.get("title", ""),
        "author": book.get("author", ""),
        "category": book.get("category", []),
        "date": book.get("date"),
        "fileKey": file_key or f"epubs/{book_id}.epub",
        "file_key": file_key or f"epubs/{book_id}.epub",
        "coverUrl": cover_url,
        "cover_url": cover_url,
        "has_cover": bool(book.get("cover")),
        "stats": stats,
        "chapters": chunked,
        "raw_chapters": raw,
    }

    with open(out_file, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)

    return out_file


# --------------------------------------------------------------------------
# 3. Load (SeaweedFS + API Gateway)
# --------------------------------------------------------------------------
_s3_client = None


def _get_s3():
    """Create the signed S3 client once (boto3 is only imported if credentials are set)."""
    global _s3_client
    if _s3_client is None:
        import boto3
        from botocore.config import Config
        _s3_client = boto3.client(
            "s3",
            endpoint_url=S3_ENDPOINT,
            aws_access_key_id=S3_ACCESS_KEY,
            aws_secret_access_key=S3_SECRET_KEY,
            region_name="us-east-1",
            config=Config(s3={"addressing_style": "path"}),
        )
        try:
            _s3_client.head_bucket(Bucket=S3_BUCKET)
        except Exception:
            try:
                _s3_client.create_bucket(Bucket=S3_BUCKET)
            except Exception:
                pass
    return _s3_client


def upload(file_bytes, key, content_type):
    """Upload a file to SeaweedFS. Raises on failure so we never return a dead URL.

    With S3_ACCESS_KEY / S3_SECRET_KEY set it sends a signed S3 request.
    Without them it falls back to a plain PUT (the team's original behaviour).
    """
    url = f"{S3_ENDPOINT.rstrip('/')}/{S3_BUCKET}/{key}"

    if S3_ACCESS_KEY and S3_SECRET_KEY:
        _get_s3().put_object(
            Bucket=S3_BUCKET, Key=key, Body=file_bytes, ContentType=content_type
        )
        return url

    res = requests.put(
        url, data=file_bytes, headers={"Content-Type": content_type}, timeout=30
    )
    res.raise_for_status()
    return url


def book_exists(book_id, api_url):
    """ASSUMPTION: GET /books/{id} returns 200 when the book is already registered.
    Confirm this with the team. If it isn't available, this returns False."""
    try:
        res = requests.get(f"{api_url.rstrip('/')}/books/{book_id}", timeout=10)
        return res.status_code == 200
    except requests.RequestException:
        return False


def register_book(payload, api_url):
    try:
        res = requests.post(f"{api_url.rstrip('/')}/books", json=payload, timeout=30)
        if res.status_code == 404:
            print("    [!] Notice: API Gateway POST /books returned 404 (endpoint not implemented yet)")
            return False
        res.raise_for_status()
        return True
    except requests.RequestException as e:
        print(f"    [!] Notice: API Gateway registration skipped ({e})")
        return False


def index_book(payload, api_url):
    try:
        res = requests.post(f"{api_url.rstrip('/')}/indexing", json=payload, timeout=300)
        if res.status_code == 404:
            print("    [!] Notice: API Gateway POST /indexing returned 404 (endpoint not implemented yet)")
            return False
        res.raise_for_status()
        return True
    except requests.RequestException as e:
        print(f"    [!] Notice: Indexing trigger skipped ({e})")
        return False


# --------------------------------------------------------------------------
# 4. Pipeline for one book
# --------------------------------------------------------------------------
def process_book(file_path, api_url=API_URL, dry_run=False, force=False, skip_api=False, save_json=False, output_dir=PARSED_JSON_DIR):
    """Run the whole pipeline for one EPUB. Returns (status, stats)."""
    book_id = generate_book_id(file_path)

    if not dry_run and not save_json and not force and book_exists(book_id, api_url):
        return "skipped", None

    book = parse_epub(file_path, book_id)
    chapters = chunk_book(book)
    if not chapters:
        raise ValueError("no text extracted (empty book or image-only?)")

    stats = summarize(book, chapters)
    file_key = f"epubs/{book_id}.epub"

    # If --save-json is requested, save the book to JSON without gateway interaction
    if save_json:
        save_to_json(book, chapters, output_dir=output_dir, file_key=file_key, stats=stats)
        return "saved", stats

    if dry_run:
        return "dry-run", stats

    # Upload the original EPUB and the cover
    upload(file_path.read_bytes(), file_key, "application/epub+zip")

    cover_url = None
    if book["cover"]:
        cover_bytes, content_type, ext = book["cover"]
        cover_url = upload(cover_bytes, f"covers/{book_id}{ext}", content_type)

    if not skip_api:
        # Register the book, then send its chunks for indexing
        register_book({
            "id": book_id,
            "title": book["title"],
            "author": book["author"],
            "category": book["category"],
            "date": book["date"],
            "coverUrl": cover_url,
            "fileKey": file_key,
        }, api_url)

        index_book({
            "bookId": book_id,
            "title": book["title"],
            "author": book["author"],
            "chapters": chapters,
        }, api_url)

    return "done", stats


# --------------------------------------------------------------------------
# 5. Batch runner
# --------------------------------------------------------------------------
def describe(stats):
    return (
        f"chapters {stats['chapters']} | chunks {stats['chunks']} | "
        f"words/chunk {stats['min']}/{stats['avg']}/{stats['max']} | "
        f"tiny {stats['tiny']} | cover {'yes' if stats['cover'] else 'NO'}"
    )


def main():
    parser = argparse.ArgumentParser(description="Ingest EPUB books into LBRE")
    parser.add_argument("--dir", default="data/ebooks", help="Folder with .epub files (searched recursively)")
    parser.add_argument("--file", help="Ingest one specific .epub file")
    parser.add_argument("--save-json", "--json", "--save-file", dest="save_json", action="store_true", help="Parse and save each book to a JSON file in data/parsed_json/ (no gateway interaction)")
    parser.add_argument("--dry-run", action="store_true", help="Parse and chunk only, no network calls")
    parser.add_argument("--force", action="store_true", help="Ingest even if the API says the book exists")
    parser.add_argument("--limit", type=int, help="Only process the first N books")
    parser.add_argument("--api-url", default=API_URL, help="API Gateway URL")
    parser.add_argument("--skip-api", action="store_true", help="Skip API Gateway registration and indexing calls")
    parser.add_argument("--output-dir", default=str(PARSED_JSON_DIR), help="Folder to save parsed JSON files (default: data/parsed_json)")
    args = parser.parse_args()

    if args.file:
        files = [Path(args.file)]
        if not files[0].exists():
            print(f"[!] File {files[0]} not found.")
            sys.exit(1)
    else:
        epub_dir = Path(args.dir)
        if not epub_dir.exists():
            print(f"[!] Directory '{epub_dir}' does not exist.")
            sys.exit(1)
        files = sorted(epub_dir.rglob("*.epub"))

    if args.limit:
        files = files[:args.limit]

    mode_desc = " (save-json mode)" if args.save_json else (" (dry run)" if args.dry_run else "")
    print(f"[*] {len(files)} EPUB file(s){mode_desc}")

    counts = {"done": 0, "saved": 0, "dry-run": 0, "skipped": 0, "failed": 0}

    for path in files:
        try:
            status, stats = process_book(
                path,
                api_url=args.api_url,
                dry_run=args.dry_run,
                force=args.force,
                skip_api=args.skip_api,
                save_json=args.save_json,
                output_dir=args.output_dir,
            )
            counts[status] += 1
            if status == "skipped":
                print(f"[SKIP] {path.name}")
            else:
                print(f"[{status.upper()}] {path.name} | {describe(stats)}")
        except Exception as error:
            counts["failed"] += 1
            print(f"[ERROR] {path.name}: {error}")
            with open(FAILED_LOG, "a", encoding="utf-8") as f:
                f.write(f"{path}\t{error}\n")

    print("\n========== Summary ==========")
    print(f"Total:   {len(files)}")
    if counts["done"]:
        print(f"Done:    {counts['done']}")
    if counts["saved"]:
        print(f"Saved:   {counts['saved']}")
    if counts["dry-run"]:
        print(f"Dry-run: {counts['dry-run']}")
    print(f"Skipped: {counts['skipped']}")
    print(f"Failed:  {counts['failed']}")
    if counts["failed"]:
        print(f"See {FAILED_LOG} for details.")


if __name__ == "__main__":
    main()