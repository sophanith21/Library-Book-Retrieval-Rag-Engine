#!/usr/bin/env python3
"""
Book Ingestion & Parsing Pipeline for Library Book Retrieval RAG Engine (LBRE)
Fulfills 'Data Retrieval & Ingestion' from architecture specifications:
- Parses EPUB files into: title, author, cover image, and chapters [{chapter_no, chunks[]}]
- Uploads EPUB + cover image to SeaweedFS (S3)
- Stores book metadata and chapter chunks into PostgreSQL (pgvector) or via API Gateway.
"""

import os
import sys
import json
import zipfile
import re
import argparse
import xml.etree.ElementTree as ET
from pathlib import Path
import requests

DEFAULT_S3_ENDPOINT = os.getenv("S3_ENDPOINT", "http://localhost:8333")
DEFAULT_API_URL = os.getenv("API_URL", "http://localhost:3000")
DEFAULT_BUCKET = os.getenv("S3_BUCKET", "books")


def clean_html(raw_html: str) -> str:
    """Strip XML/HTML tags and normalize whitespace."""
    cleanr = re.compile(r"<[^>]+>")
    cleantext = re.sub(cleanr, " ", raw_html)
    return " ".join(cleantext.split())


def chunk_text(text: str, chunk_size: int = 150, overlap: int = 30) -> list[str]:
    """Split text into overlapping token windows for sparse & dense indexing."""
    words = text.split()
    if len(words) <= chunk_size:
        return [text] if text.strip() else []

    chunks = []
    start = 0
    while start < len(words):
        end = min(start + chunk_size, len(words))
        chunks.append(" ".join(words[start:end]))
        if end == len(words):
            break
        start += (chunk_size - overlap)
    return chunks


def parse_epub(epub_path: Path):
    """
    Extracts metadata and chapter chunks directly from an EPUB file (ZIP container).
    """
    with zipfile.ZipFile(epub_path, "r") as z:
        # 1. Find container.xml to locate content.opf
        container_xml = z.read("META-INF/container.xml")
        root = ET.fromstring(container_xml)
        rootfile_tag = root.find(".//{urn:oasis:names:tc:opendocument:xmlns:container}rootfile")
        opf_path = rootfile_tag.get("full-path") if rootfile_tag is not None else "epub/content.opf"

        # 2. Parse OPF file for metadata & manifest
        opf_dir = os.path.dirname(opf_path)
        opf_xml = z.read(opf_path)
        opf_root = ET.fromstring(opf_xml)

        ns = {
            "opf": "http://www.idpf.org/2007/opf",
            "dc": "http://purl.org/dc/elements/1.1/",
        }

        title_el = opf_root.find(".//dc:title", ns)
        title = title_el.text.strip() if title_el is not None and title_el.text else epub_path.stem.replace("_", " ").title()

        creator_el = opf_root.find(".//dc:creator", ns)
        author = creator_el.text.strip() if creator_el is not None and creator_el.text else "Unknown Author"

        # 3. Find cover image if available
        cover_filename = None
        for item in opf_root.findall(".//opf:item", ns):
            props = item.get("properties", "")
            media_type = item.get("media-type", "")
            item_id = item.get("id", "")
            if "cover-image" in props or "cover" in item_id or "image" in media_type and "cover" in item.get("href", ""):
                href = item.get("href")
                cover_filename = f"{opf_dir}/{href}" if opf_dir else href
                break

        cover_bytes = None
        if cover_filename and cover_filename in z.namelist():
            cover_bytes = z.read(cover_filename)

        # 4. Extract chapters from HTML/XHTML spine items
        manifest_items = {item.get("id"): item.get("href") for item in opf_root.findall(".//opf:item", ns)}
        spine_items = [manifest_items.get(ref.get("idref")) for ref in opf_root.findall(".//opf:itemref", ns) if manifest_items.get(ref.get("idref"))]

        chapters = []
        chapter_no = 1

        for href in spine_items:
            full_href = f"{opf_dir}/{href}" if opf_dir else href
            if full_href in z.namelist() and (full_href.endswith(".xhtml") or full_href.endswith(".html")):
                content_html = z.read(full_href).decode("utf-8", errors="ignore")
                plain_text = clean_html(content_html)
                if len(plain_text) > 100:  # Skip trivial copyright/title pages
                    chunks = chunk_text(plain_text)
                    if chunks:
                        chapters.append({
                            "chapter_no": chapter_no,
                            "chunks": chunks
                        })
                        chapter_no += 1

        return {
            "title": title,
            "author": author,
            "chapters": chapters,
            "cover_bytes": cover_bytes,
            "file_name": epub_path.name
        }


def upload_to_seaweedfs(file_bytes: bytes, key: str, content_type: str = "application/octet-stream", s3_endpoint: str = DEFAULT_S3_ENDPOINT, bucket: str = DEFAULT_BUCKET) -> str:
    """Uploads file directly to SeaweedFS S3 endpoint."""
    url = f"{s3_endpoint.rstrip('/')}/{bucket}/{key}"
    try:
        res = requests.put(url, data=file_bytes, headers={"Content-Type": content_type}, timeout=10)
        if res.status_code in (200, 201):
            return url
    except Exception as e:
        print(f"[!] Warning: Could not upload {key} to SeaweedFS: {e}")
    return url


def ingest_epub(epub_path: Path, api_url: str = DEFAULT_API_URL, dry_run: bool = False):
    print(f"\n[*] Parsing: {epub_path.name}")
    data = parse_epub(epub_path)
    print(f"    Title:    {data['title']}")
    print(f"    Author:   {data['author']}")
    total_chunks = sum(len(c['chunks']) for c in data['chapters'])
    print(f"    Chapters: {len(data['chapters'])} ({total_chunks} total chunks)")

    if dry_run:
        print("    [Dry-run] Extracted successfully without network upload.")
        return

    # 1. Upload EPUB to SeaweedFS
    with open(epub_path, "rb") as f:
        file_bytes = f.read()
    file_key = f"epubs/{epub_path.name}"
    upload_to_seaweedfs(file_bytes, file_key, "application/epub+zip")

    # 2. Upload cover if available
    cover_url = None
    if data["cover_bytes"]:
        cover_key = f"covers/{epub_path.stem}.jpg"
        cover_url = upload_to_seaweedfs(data["cover_bytes"], cover_key, "image/jpeg")

    # 3. Create Book in API Gateway
    book_id = f"book-{epub_path.stem[:30]}"
    book_payload = {
        "id": book_id,
        "title": data["title"],
        "author": data["author"],
        "coverUrl": cover_url,
        "fileKey": file_key
    }

    try:
        res = requests.post(f"{api_url.rstrip('/')}/books", json=book_payload, timeout=5)
        print(f"    [+] Registered book metadata: {res.status_code}")
    except Exception as e:
        print(f"    [!] Notice: API Gateway registration skipped ({e})")

    # 4. Trigger Sparse & Dense Indexing
    index_payload = {
        "bookId": book_id,
        "title": data["title"],
        "author": data["author"],
        "chapters": data["chapters"]
    }
    try:
        res = requests.post(f"{api_url.rstrip('/')}/indexing", json=index_payload, timeout=15)
        print(f"    [+] Indexed book chunks into pgvector & BM25: {res.status_code}")
    except Exception as e:
        print(f"    [!] Notice: Indexing trigger skipped ({e})")


def main():
    parser = argparse.ArgumentParser(description="Ingest EPUB books into LBRE")
    parser.add_argument("--dir", default="downloads_epubs", help="Directory containing downloaded .epub files")
    parser.add_argument("--file", help="Specific .epub file to parse")
    parser.add_argument("--dry-run", action="store_true", help="Parse without uploading")
    parser.add_argument("--api-url", default=DEFAULT_API_URL, help="API Gateway URL")
    args = parser.parse_args()

    if args.file:
        path = Path(args.file)
        if not path.exists():
            print(f"[!] File {path} not found.")
            sys.exit(1)
        ingest_epub(path, api_url=args.api_url, dry_run=args.dry_run)
    else:
        epub_dir = Path(args.dir)
        if not epub_dir.exists():
            print(f"[!] Directory '{epub_dir}' does not exist yet. Run downloader.py first or specify --file.")
            sys.exit(0)
        epub_files = list(epub_dir.glob("*.epub"))
        print(f"[*] Found {len(epub_files)} EPUB files in {epub_dir}")
        for path in epub_files[:20]: # batch ingest sample
            ingest_epub(path, api_url=args.api_url, dry_run=args.dry_run)


if __name__ == "__main__":
    main()
