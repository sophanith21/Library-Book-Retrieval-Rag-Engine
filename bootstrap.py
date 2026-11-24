#!/usr/bin/env python3
"""
Idempotent Bootstrap Script for Library Book Retrieval RAG Engine (LBRE)

Bootstraps:
  1. Parsed JSON dataset (local `parsed_books.json` + uploaded to SeaweedFS `parsed/{bookId}.json`)
     in the exact `ProcessBookIndexDto` schema used by both Sparse (BM25) and Dense (pgvector) indexing.
  2. SeaweedFS S3 storage (creates `books` bucket if missing, uploads EPUBs, covers, and parsed JSON
     with proper AWS SigV4 auth; skips objects that already exist unless `--force` is passed).
  3. PostgreSQL `book.books` table (idempotent `ON CONFLICT (id) DO UPDATE` upsert when `psql` or
     `psycopg2` is available).
  4. Indexing Microservice (checks `GET /indexing/{bookId}` and skips books already `'done'` unless
     `--force` is passed, queues `POST /indexing`, polls until done, then runs `POST /indexing/finalize`
     for BM25 stats and `POST /indexing/embed` for any missing dense pgvector embeddings).

Usage examples:
  # Quick smoke-test with 5 built-in sample books (no EPUB download needed):
  python3 bootstrap.py --sample

  # Bootstrap from downloaded EPUBs (first 20 books, or --limit 0 for all):
  python3 bootstrap.py --dir downloads_epubs --limit 20

  # Bootstrap from an existing parsed JSON file:
  python3 bootstrap.py --json parsed_books.json

  # Only generate parsed_books.json + upload to SeaweedFS (skip indexing):
  python3 bootstrap.py --dir downloads_epubs --skip-indexing
"""

import argparse
import datetime
import hashlib
import hmac
import json
import os
import re
import shutil
import subprocess
import sys
import time
import urllib.parse
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path
from typing import Any

import requests

DEFAULT_S3_ENDPOINT = os.getenv("S3_ENDPOINT", "http://localhost:8333")
DEFAULT_S3_ACCESS_KEY = os.getenv("S3_ACCESS_KEY", "devaccess")
DEFAULT_S3_SECRET_KEY = os.getenv("S3_SECRET_KEY", "devsecret")
DEFAULT_S3_BUCKET = os.getenv("S3_BUCKET", "books")
DEFAULT_S3_REGION = os.getenv("S3_REGION", "us-east-1")
DEFAULT_API_URL = os.getenv("API_URL", "http://localhost:3000")
DEFAULT_DATABASE_URL = os.getenv(
    "DATABASE_URL", "postgres://postgres:postgres@localhost:5432/app"
)


# =============================================================================
# Built-in sample books for instant smoke-testing (sparse + dense + RAG)
# =============================================================================

SAMPLE_BOOKS: list[dict[str, Any]] = [
    {
        "bookId": "sample-quantum-mechanics",
        "title": "Introduction to Quantum Mechanics",
        "author": "David J. Griffiths",
        "coverUrl": None,
        "fileKey": None,
        "chapters": [
            {
                "chapterNo": 1,
                "chunks": [
                    (
                        "The wave function psi(x, t) contains all dynamical information about a quantum state. "
                        "According to Born's statistical interpretation, the probability of finding a particle "
                        "between x and x + dx is |psi(x, t)|^2 dx. Normalization requires the total integral "
                        "over all space to equal one."
                    ),
                    (
                        "Heisenberg's uncertainty principle dictates that the product of standard deviations "
                        "in position and momentum is bounded below by h-bar divided by two. This is not a flaw "
                        "in measurement apparatus, but an intrinsic property of wave packets in quantum mechanics."
                    ),
                ],
            },
            {
                "chapterNo": 2,
                "chunks": [
                    (
                        "Quantum superposition allows a qubit to exist simultaneously in linear combinations "
                        "of basis states |0> and |1>. When multiple qubits become entangled, their joint state "
                        "cannot be factored into independent single-qubit states, creating an exponentially "
                        "large Hilbert space that underpins quantum computation."
                    ),
                ],
            },
        ],
    },
    {
        "bookId": "sample-quantum-computation",
        "title": "Principles of Quantum Computation and Information",
        "author": "Giuliano Benenti",
        "coverUrl": None,
        "fileKey": None,
        "chapters": [
            {
                "chapterNo": 1,
                "chunks": [
                    (
                        "Quantum logic gates such as Hadamard, Pauli-X, Phase, and Controlled-NOT (CNOT) "
                        "act as reversible unitary transformations on qubit state vectors, preserving "
                        "probability amplitude norms throughout a quantum circuit."
                    ),
                    (
                        "Shor's algorithm performs integer factorization in polynomial time on a fault-tolerant "
                        "quantum computer by reducing factoring to period finding via the Quantum Fourier "
                        "Transform, directly threatening RSA public-key cryptography."
                    ),
                ],
            },
            {
                "chapterNo": 2,
                "chunks": [
                    (
                        "Grover's search algorithm provides a quadratic speedup for searching an unstructured "
                        "database of N items, locating a marked target in O(sqrt(N)) oracle queries through "
                        "iterative amplitude amplification."
                    ),
                ],
            },
        ],
    },
    {
        "bookId": "sample-electrodynamics",
        "title": "Classical Electrodynamics",
        "author": "John David Jackson",
        "coverUrl": None,
        "fileKey": None,
        "chapters": [
            {
                "chapterNo": 1,
                "chunks": [
                    (
                        "Maxwell's four equations unify electricity and magnetism, describing how electric "
                        "charges and currents generate electric and magnetic fields and how time-varying "
                        "magnetic fields induce electromotive force according to Faraday's law."
                    ),
                    (
                        "In vacuum, Maxwell's equations admit transverse electromagnetic wave solutions "
                        "propagating at the speed of light c, demonstrating that visible light is an "
                        "electromagnetic phenomenon."
                    ),
                ],
            },
        ],
    },
    {
        "bookId": "sample-information-retrieval",
        "title": "Introduction to Information Retrieval",
        "author": "Christopher D. Manning",
        "coverUrl": None,
        "fileKey": None,
        "chapters": [
            {
                "chapterNo": 1,
                "chunks": [
                    (
                        "An inverted index maps every normalized vocabulary term to a postings list of "
                        "document identifiers, term frequencies, and token positions. Okapi BM25 scores "
                        "candidate passages by combining inverse document frequency with saturating term "
                        "frequency and document length normalization."
                    ),
                    (
                        "Dense vector retrieval encodes passages and user queries into low-dimensional "
                        "semantic embeddings. Approximate nearest neighbor indexes such as Hierarchical "
                        "Navigable Small World (HNSW) graphs enable sub-linear cosine similarity search "
                        "across millions of chunks."
                    ),
                ],
            },
            {
                "chapterNo": 2,
                "chunks": [
                    (
                        "Reciprocal Rank Fusion (RRF) merges ranked lists from sparse lexical search and "
                        "dense semantic search without requiring score calibration, assigning each chunk "
                        "a combined score of sum(1 / (k + rank_i)) with smoothing constant k = 60."
                    ),
                ],
            },
        ],
    },
    {
        "bookId": "sample-moby-dick",
        "title": "Moby-Dick; or, The Whale",
        "author": "Herman Melville",
        "coverUrl": None,
        "fileKey": None,
        "chapters": [
            {
                "chapterNo": 1,
                "chunks": [
                    (
                        "Call me Ishmael. Some years ago—never mind how long precisely—having little or "
                        "no money in my purse, and nothing particular to interest me on shore, I thought "
                        "I would sail about a little and see the watery part of the world."
                    ),
                    (
                        "Captain Ahab's monomaniacal pursuit of the great white whale drives the Pequod "
                        "across the Pacific Ocean, turning a commercial whaling voyage into a fateful "
                        "confrontation between human obsession and nature."
                    ),
                ],
            },
        ],
    },
]


# =============================================================================
# AWS SigV4 S3 Client for SeaweedFS (stdlib + requests, zero extra deps)
# =============================================================================


class SeaweedS3Client:
    def __init__(
        self,
        endpoint: str,
        access_key: str,
        secret_key: str,
        bucket: str,
        region: str = DEFAULT_S3_REGION,
    ):
        self.endpoint = endpoint.rstrip("/")
        self.access_key = access_key
        self.secret_key = secret_key
        self.bucket = bucket
        self.region = region
        self.session = requests.Session()

    def _sign_headers(
        self,
        method: str,
        path: str,
        payload: bytes = b"",
        content_type: str | None = None,
    ) -> dict[str, str]:
        parsed = urllib.parse.urlparse(self.endpoint)
        host = parsed.netloc
        now = datetime.datetime.now(datetime.timezone.utc)
        amz_date = now.strftime("%Y%m%dT%H%M%SZ")
        date_stamp = now.strftime("%Y%m%d")
        payload_hash = hashlib.sha256(payload).hexdigest()

        canonical_uri = urllib.parse.quote(path, safe="/-_.~")
        headers: dict[str, str] = {
            "host": host,
            "x-amz-content-sha256": payload_hash,
            "x-amz-date": amz_date,
        }
        if content_type:
            headers["content-type"] = content_type

        sorted_keys = sorted(headers.keys())
        canonical_headers = "".join(f"{k}:{headers[k]}\n" for k in sorted_keys)
        signed_headers = ";".join(sorted_keys)

        canonical_request = "\n".join(
            [
                method,
                canonical_uri,
                "",
                canonical_headers,
                signed_headers,
                payload_hash,
            ]
        )

        credential_scope = f"{date_stamp}/{self.region}/s3/aws4_request"
        string_to_sign = "\n".join(
            [
                "AWS4-HMAC-SHA256",
                amz_date,
                credential_scope,
                hashlib.sha256(canonical_request.encode("utf-8")).hexdigest(),
            ]
        )

        def _sign(key: bytes, msg: str) -> bytes:
            return hmac.new(key, msg.encode("utf-8"), hashlib.sha256).digest()

        k_date = _sign(f"AWS4{self.secret_key}".encode("utf-8"), date_stamp)
        k_region = _sign(k_date, self.region)
        k_service = _sign(k_region, "s3")
        k_signing = _sign(k_service, "aws4_request")
        signature = hmac.new(
            k_signing, string_to_sign.encode("utf-8"), hashlib.sha256
        ).hexdigest()

        auth_header = (
            f"AWS4-HMAC-SHA256 Credential={self.access_key}/{credential_scope}, "
            f"SignedHeaders={signed_headers}, Signature={signature}"
        )

        out = {
            "x-amz-date": amz_date,
            "x-amz-content-sha256": payload_hash,
            "Authorization": auth_header,
        }
        if content_type:
            out["Content-Type"] = content_type
        return out

    def ensure_bucket(self) -> None:
        path = f"/{self.bucket}"
        url = f"{self.endpoint}{path}"
        head = self.session.head(
            url, headers=self._sign_headers("HEAD", path), timeout=10
        )
        if head.status_code == 200:
            return
        put = self.session.put(
            url, headers=self._sign_headers("PUT", path), timeout=10
        )
        if put.status_code not in (200, 201, 409):
            raise RuntimeError(
                f"Failed to create SeaweedFS bucket '{self.bucket}': "
                f"HTTP {put.status_code} {put.text[:200]}"
            )
        print(f"[+] Created SeaweedFS S3 bucket: {self.bucket}")

    def exists(self, key: str) -> bool:
        path = f"/{self.bucket}/{key.lstrip('/')}"
        url = f"{self.endpoint}{path}"
        res = self.session.head(
            url, headers=self._sign_headers("HEAD", path), timeout=10
        )
        return res.status_code == 200

    def put_object_idempotent(
        self,
        key: str,
        data: bytes,
        content_type: str = "application/octet-stream",
        force: bool = False,
    ) -> tuple[str, bool]:
        """Uploads object if missing (or force=True). Returns (url, uploaded)."""
        clean_key = key.lstrip("/")
        path = f"/{self.bucket}/{clean_key}"
        url = f"{self.endpoint}{path}"

        if not force and self.exists(clean_key):
            return url, False

        headers = self._sign_headers("PUT", path, data, content_type=content_type)
        res = self.session.put(url, data=data, headers=headers, timeout=30)
        if res.status_code not in (200, 201):
            raise RuntimeError(
                f"SeaweedFS PUT {clean_key} failed: HTTP {res.status_code} {res.text[:200]}"
            )
        return url, True


# =============================================================================
# EPUB Parsing & Normalization
# =============================================================================


def clean_html(raw_html: str) -> str:
    text = re.sub(r"<[^>]+>", " ", raw_html)
    return " ".join(text.split())


def chunk_text(text: str, chunk_size: int = 150, overlap: int = 30) -> list[str]:
    words = text.split()
    if len(words) <= chunk_size:
        return [text] if text.strip() else []
    chunks: list[str] = []
    start = 0
    while start < len(words):
        end = min(start + chunk_size, len(words))
        chunks.append(" ".join(words[start:end]))
        if end == len(words):
            break
        start += chunk_size - overlap
    return chunks


def make_stable_book_id(epub_path: Path) -> str:
    """Deterministic bookId from filename so re-runs always map to the same ID."""
    slug = re.sub(r"[^a-z0-9-]+", "-", epub_path.stem.lower()).strip("-")
    if len(slug) <= 48:
        return f"book-{slug}"
    digest = hashlib.sha1(epub_path.name.encode("utf-8")).hexdigest()[:8]
    return f"book-{slug[:39]}-{digest}"


def parse_epub_file(
    epub_path: Path, chunk_size: int = 150, overlap: int = 30
) -> tuple[dict[str, Any], bytes | None]:
    with zipfile.ZipFile(epub_path, "r") as z:
        container_xml = z.read("META-INF/container.xml")
        root = ET.fromstring(container_xml)
        rootfile_tag = root.find(
            ".//{urn:oasis:names:tc:opendocument:xmlns:container}rootfile"
        )
        opf_path = (
            rootfile_tag.get("full-path")
            if rootfile_tag is not None
            else "epub/content.opf"
        )

        opf_dir = os.path.dirname(opf_path)
        opf_root = ET.fromstring(z.read(opf_path))
        ns = {
            "opf": "http://www.idpf.org/2007/opf",
            "dc": "http://purl.org/dc/elements/1.1/",
        }

        title_el = opf_root.find(".//dc:title", ns)
        title = (
            title_el.text.strip()
            if title_el is not None and title_el.text
            else epub_path.stem.replace("_", " ").title()
        )
        creator_el = opf_root.find(".//dc:creator", ns)
        author = (
            creator_el.text.strip()
            if creator_el is not None and creator_el.text
            else "Unknown Author"
        )

        cover_bytes = None
        for item in opf_root.findall(".//opf:item", ns):
            props = item.get("properties", "")
            media_type = item.get("media-type", "")
            item_id = item.get("id", "")
            href = item.get("href", "")
            if (
                "cover-image" in props
                or "cover" in item_id
                or ("image" in media_type and "cover" in href)
            ):
                candidate = f"{opf_dir}/{href}" if opf_dir else href
                if candidate in z.namelist():
                    cover_bytes = z.read(candidate)
                    break

        manifest = {
            item.get("id"): item.get("href")
            for item in opf_root.findall(".//opf:item", ns)
        }
        spine_hrefs = [
            manifest[ref.get("idref")]
            for ref in opf_root.findall(".//opf:itemref", ns)
            if ref.get("idref") in manifest
        ]

        chapters: list[dict[str, Any]] = []
        chapter_no = 1
        for href in spine_hrefs:
            full_href = f"{opf_dir}/{href}" if opf_dir else href
            if full_href in z.namelist() and full_href.endswith((".xhtml", ".html")):
                plain = clean_html(z.read(full_href).decode("utf-8", errors="ignore"))
                if len(plain) > 100:
                    chunks = chunk_text(plain, chunk_size=chunk_size, overlap=overlap)
                    if chunks:
                        chapters.append({"chapterNo": chapter_no, "chunks": chunks})
                        chapter_no += 1

        book_id = make_stable_book_id(epub_path)
        record = {
            "bookId": book_id,
            "title": title,
            "author": author,
            "coverUrl": None,
            "fileKey": f"epubs/{epub_path.name}",
            "chapters": chapters,
        }
        return record, cover_bytes


def normalize_book_record(raw: dict[str, Any], idx: int) -> dict[str, Any]:
    """Normalizes any pre-parsed JSON book shape into ProcessBookIndexDto format."""
    book_id = raw.get("bookId") or raw.get("id") or f"book-{idx + 1}"
    title = raw.get("title") or book_id
    author = raw.get("author") or "Unknown Author"
    chapters_out: list[dict[str, Any]] = []

    for c_idx, ch in enumerate(raw.get("chapters") or [], start=1):
        if not isinstance(ch, dict):
            continue
        ch_no = ch.get("chapterNo") or ch.get("chapter_no") or c_idx
        try:
            ch_no = int(ch_no)
        except (TypeError, ValueError):
            ch_no = c_idx

        chunks = ch.get("chunks")
        if isinstance(chunks, list):
            clean_chunks = [c.strip() for c in chunks if isinstance(c, str) and c.strip()]
        elif isinstance(ch.get("text"), str) and ch["text"].strip():
            clean_chunks = chunk_text(ch["text"].strip())
        else:
            clean_chunks = []

        if clean_chunks:
            chapters_out.append({"chapterNo": ch_no, "chunks": clean_chunks})

    return {
        "bookId": str(book_id),
        "title": str(title),
        "author": str(author),
        "coverUrl": raw.get("coverUrl") or raw.get("cover_url"),
        "fileKey": raw.get("fileKey") or raw.get("file_key"),
        "chapters": chapters_out,
    }


# =============================================================================
# PostgreSQL Idempotent Upsert for book.books
# =============================================================================


def upsert_books_postgres(books: list[dict[str, Any]], database_url: str) -> None:
    """Idempotently upserts book metadata into Postgres book.books."""
    if not books:
        return

    sql_lines = [
        "BEGIN;",
        "CREATE SCHEMA IF NOT EXISTS book;",
        """CREATE TABLE IF NOT EXISTS book.books (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            author TEXT NOT NULL DEFAULT 'Unknown',
            "coverUrl" TEXT,
            "fileKey" TEXT,
            "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
        );""",
    ]

    def sql_str(val: str | None) -> str:
        if val is None:
            return "NULL"
        return "'" + val.replace("'", "''") + "'"

    for b in books:
        sql_lines.append(
            f"""INSERT INTO book.books (id, title, author, "coverUrl", "fileKey", "createdAt", "updatedAt")
VALUES ({sql_str(b['bookId'])}, {sql_str(b['title'])}, {sql_str(b['author'])}, {sql_str(b.get('coverUrl'))}, {sql_str(b.get('fileKey'))}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT (id) DO UPDATE SET
  title = EXCLUDED.title,
  author = EXCLUDED.author,
  "coverUrl" = COALESCE(EXCLUDED."coverUrl", book.books."coverUrl"),
  "fileKey" = COALESCE(EXCLUDED."fileKey", book.books."fileKey"),
  "updatedAt" = CURRENT_TIMESTAMP;"""
        )
    sql_lines.append("COMMIT;")
    sql_payload = "\n".join(sql_lines)

    # Prefer psycopg2 if installed, otherwise fall back to psql CLI
    try:
        import psycopg2  # type: ignore

        conn = psycopg2.connect(database_url)
        try:
            with conn.cursor() as cur:
                cur.execute(sql_payload)
            conn.commit()
            print(f"[+] Upserted {len(books)} books into Postgres book.books (via psycopg2)")
            return
        finally:
            conn.close()
    except ImportError:
        pass
    except Exception as exc:
        print(f"[!] Postgres upsert via psycopg2 failed: {exc}")
        return

    if shutil.which("psql"):
        res = subprocess.run(
            ["psql", database_url, "-v", "ON_ERROR_STOP=1", "-q"],
            input=sql_payload,
            text=True,
            capture_output=True,
        )
        if res.returncode == 0:
            print(f"[+] Upserted {len(books)} books into Postgres book.books (via psql)")
        else:
            print(f"[!] Postgres upsert via psql failed: {res.stderr.strip()}")
    else:
        print(
            "[i] Skipping direct book.books DB upsert (neither psycopg2 nor psql found on host). "
            "Indexing will still populate knowledge.indexed_books & knowledge.chunks."
        )


# =============================================================================
# Idempotent Indexing Trigger (Sparse BM25 + Dense PgVector)
# =============================================================================


def index_books_idempotent(
    books: list[dict[str, Any]],
    api_url: str,
    force: bool = False,
    wait_timeout_sec: int = 180,
) -> None:
    base = api_url.rstrip("/")
    queued_ids: list[str] = []
    skipped = 0

    for b in books:
        book_id = b["bookId"]
        if not force:
            try:
                st = requests.get(f"{base}/indexing/{book_id}", timeout=5)
                if st.status_code == 200 and st.json().get("status") == "done":
                    skipped += 1
                    continue
            except Exception:
                pass

        payload = {
            "bookId": book_id,
            "title": b["title"],
            "author": b["author"],
            "chapters": b["chapters"],
        }
        res = requests.post(f"{base}/indexing", json=payload, timeout=30)
        if res.status_code in (200, 201, 202):
            queued_ids.append(book_id)
        else:
            print(f"[!] Failed to queue {book_id}: HTTP {res.status_code} {res.text[:200]}")

    print(
        f"[+] Indexing queue: {len(queued_ids)} queued, {skipped} already 'done' (skipped)"
    )

    # Poll until queued books finish so finalize + embed see all chunks
    if queued_ids:
        deadline = time.time() + wait_timeout_sec
        remaining = set(queued_ids)
        while remaining and time.time() < deadline:
            for bid in list(remaining):
                try:
                    st = requests.get(f"{base}/indexing/{bid}", timeout=5)
                    if st.status_code == 200:
                        status = st.json().get("status")
                        if status in ("done", "failed"):
                            if status == "failed":
                                print(f"[!] Book {bid} failed indexing: {st.json().get('error')}")
                            remaining.discard(bid)
                except Exception:
                    pass
            if remaining:
                time.sleep(1.0)
        if remaining:
            print(f"[!] Timed out waiting for {len(remaining)} books: {sorted(remaining)[:5]}")

    # 1. Finalize sparse BM25 corpus stats (idempotent)
    print("[*] Finalizing sparse BM25 index stats (POST /indexing/finalize)...")
    try:
        fin = requests.post(f"{base}/indexing/finalize", timeout=300)
        print(f"    [+] Finalize ({fin.status_code}): {fin.text[:200]}")
    except Exception as exc:
        print(f"    [!] Finalize failed: {exc}")

    # 2. Backfill any chunks still missing dense embeddings (idempotent)
    print("[*] Ensuring dense pgvector embeddings (POST /indexing/embed)...")
    try:
        emb = requests.post(
            f"{base}/indexing/embed", json={"limit": 5000}, timeout=600
        )
        print(f"    [+] Embed ({emb.status_code}): {emb.text[:200]}")
    except Exception as exc:
        print(f"    [!] Dense embed call failed: {exc}")


# =============================================================================
# CLI Entrypoint
# =============================================================================


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Idempotent bootstrap for SeaweedFS, parsed JSON, Postgres, and Sparse+Dense Indexing"
    )
    src = parser.add_mutually_exclusive_group(required=True)
    src.add_argument(
        "--sample",
        action="store_true",
        help="Use built-in 5-book sample dataset (no EPUB downloads required)",
    )
    src.add_argument(
        "--dir",
        help="Directory containing downloaded .epub files (e.g. downloads_epubs)",
    )
    src.add_argument(
        "--json",
        help="Path to an existing parsed books JSON file",
    )

    parser.add_argument(
        "--limit",
        type=int,
        default=20,
        help="Max EPUBs to process from --dir (0 = all, default: 20)",
    )
    parser.add_argument(
        "--out-json",
        default="parsed_books.json",
        help="Output path for the normalized parsed JSON file (default: parsed_books.json)",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Re-upload S3 objects and re-index books even if already present/done",
    )
    parser.add_argument(
        "--skip-s3",
        action="store_true",
        help="Skip SeaweedFS S3 uploads",
    )
    parser.add_argument(
        "--skip-db",
        action="store_true",
        help="Skip direct Postgres book.books upsert",
    )
    parser.add_argument(
        "--skip-indexing",
        action="store_true",
        help="Skip calling API Gateway /indexing endpoints",
    )
    parser.add_argument("--s3-endpoint", default=DEFAULT_S3_ENDPOINT)
    parser.add_argument("--s3-access-key", default=DEFAULT_S3_ACCESS_KEY)
    parser.add_argument("--s3-secret-key", default=DEFAULT_S3_SECRET_KEY)
    parser.add_argument("--s3-bucket", default=DEFAULT_S3_BUCKET)
    parser.add_argument("--api-url", default=DEFAULT_API_URL)
    parser.add_argument("--database-url", default=DEFAULT_DATABASE_URL)
    args = parser.parse_args()

    # -------------------------------------------------------------------------
    # Step 1: Load / Parse Books
    # -------------------------------------------------------------------------
    books: list[dict[str, Any]] = []
    epub_assets: dict[str, tuple[Path, bytes | None]] = {}

    if args.sample:
        books = [normalize_book_record(b, i) for i, b in enumerate(SAMPLE_BOOKS)]
        print(f"[*] Loaded {len(books)} built-in sample books")
    elif args.json:
        raw = json.loads(Path(args.json).read_text(encoding="utf-8"))
        items = raw if isinstance(raw, list) else [raw]
        books = [normalize_book_record(b, i) for i, b in enumerate(items)]
        print(f"[*] Loaded {len(books)} books from {args.json}")
    else:
        epub_dir = Path(args.dir)
        if not epub_dir.exists():
            print(f"[!] Directory '{epub_dir}' not found. Run downloader.py first or use --sample.")
            sys.exit(1)
        epub_files = sorted(epub_dir.glob("*.epub"))
        if args.limit > 0:
            epub_files = epub_files[: args.limit]
        print(f"[*] Parsing {len(epub_files)} EPUB files from {epub_dir}...")
        for path in epub_files:
            try:
                rec, cover = parse_epub_file(path)
                if not rec["chapters"]:
                    print(f"    [!] Skipping {path.name} (no text chapters extracted)")
                    continue
                books.append(rec)
                epub_assets[rec["bookId"]] = (path, cover)
            except Exception as exc:
                print(f"    [!] Failed to parse {path.name}: {exc}")

    if not books:
        print("[!] No books to bootstrap.")
        sys.exit(1)

    # -------------------------------------------------------------------------
    # Step 2: Idempotent SeaweedFS S3 Bootstrap (EPUBs, Covers, Parsed JSON)
    # -------------------------------------------------------------------------
    if not args.skip_s3:
        s3 = SeaweedS3Client(
            endpoint=args.s3_endpoint,
            access_key=args.s3_access_key,
            secret_key=args.s3_secret_key,
            bucket=args.s3_bucket,
        )
        s3.ensure_bucket()
        uploaded_count = 0
        skipped_count = 0

        for b in books:
            bid = b["bookId"]
            if bid in epub_assets:
                epub_path, cover_bytes = epub_assets[bid]
                _, did_up = s3.put_object_idempotent(
                    b["fileKey"],
                    epub_path.read_bytes(),
                    content_type="application/epub+zip",
                    force=args.force,
                )
                uploaded_count += int(did_up)
                skipped_count += int(not did_up)

                if cover_bytes:
                    cover_key = f"covers/{bid}.jpg"
                    cover_url, did_up = s3.put_object_idempotent(
                        cover_key,
                        cover_bytes,
                        content_type="image/jpeg",
                        force=args.force,
                    )
                    b["coverUrl"] = cover_url
                    uploaded_count += int(did_up)
                    skipped_count += int(not did_up)

            # Always upload per-book parsed JSON to SeaweedFS: parsed/{bookId}.json
            parsed_key = f"parsed/{bid}.json"
            _, did_up = s3.put_object_idempotent(
                parsed_key,
                json.dumps(b, ensure_ascii=False, indent=2).encode("utf-8"),
                content_type="application/json",
                force=args.force,
            )
            uploaded_count += int(did_up)
            skipped_count += int(not did_up)

        # Upload combined parsed catalog JSON
        _, did_up = s3.put_object_idempotent(
            "parsed/catalog.json",
            json.dumps(books, ensure_ascii=False, indent=2).encode("utf-8"),
            content_type="application/json",
            force=True if uploaded_count > 0 or args.force else False,
        )
        print(
            f"[+] SeaweedFS ({args.s3_endpoint}/{args.s3_bucket}): "
            f"{uploaded_count} uploaded, {skipped_count} already existed (skipped)"
        )

    # -------------------------------------------------------------------------
    # Step 3: Write Local Normalized Parsed JSON File
    # -------------------------------------------------------------------------
    out_path = Path(args.out_json)
    out_path.write_text(
        json.dumps(books, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    total_chunks = sum(
        len(ch["chunks"]) for b in books for ch in b["chapters"]
    )
    print(
        f"[+] Wrote parsed JSON to {out_path} ({len(books)} books, {total_chunks} chunks)"
    )

    # -------------------------------------------------------------------------
    # Step 4: Idempotent Postgres book.books Upsert
    # -------------------------------------------------------------------------
    if not args.skip_db:
        upsert_books_postgres(books, args.database_url)

    # -------------------------------------------------------------------------
    # Step 5: Idempotent Sparse + Dense Indexing via API Gateway
    # -------------------------------------------------------------------------
    if not args.skip_indexing:
        index_books_idempotent(books, api_url=args.api_url, force=args.force)

    print("\n[*] Bootstrap complete!")


if __name__ == "__main__":
    main()
