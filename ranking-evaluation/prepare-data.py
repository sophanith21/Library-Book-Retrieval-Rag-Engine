import json
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent

INPUT_FILE = BASE_DIR / "sampled-data" / "data" / "data-sample.json"
OUTPUT_FILE = BASE_DIR / "sampled-data" / "data" / "documents.json"

def extract_documents(books):
    documents = []

    for book in books:

        # Get book metadata
        book_id = book.get("bookId") or book.get("id")
        title = book.get("title", "")
        author = book.get("author", "")
        category = book.get("category", [])

        chapters = book.get("chapters", [])

        if not isinstance(chapters, list):
            continue

        for chapter_index, chapter in enumerate(chapters, start=1):

            if not isinstance(chapter, dict):
                continue

            chapter_id = chapter.get(
                "chapter_no",
                chapter.get("chapter_title", chapter_index)
            )

            # Format 1: Chapter contains multiple chunks
            chunks = chapter.get("chunks")

            if isinstance(chunks, list):

                for chunk_index, chunk_text in enumerate(chunks, start=1):

                    if not isinstance(chunk_text, str) or not chunk_text.strip():
                        continue

                    documents.append({
                        "doc_id": f"{book_id}_ch{chapter_index}_chunk{chunk_index}",
                        "book_id": book_id,
                        "title": title,
                        "author": author,
                        "category": category,
                        "chapter": chapter_id,
                        "chunk_index": chunk_index,
                        "text": chunk_text.strip()
                    })

            # Format 2: Chapter contains full text
            elif isinstance(chapter.get("text"), str):

                chapter_text = chapter["text"]

                if not chapter_text.strip():
                    continue

                documents.append({
                    "doc_id": f"{book_id}_ch{chapter_index}",
                    "book_id": book_id,
                    "title": title,
                    "author": author,
                    "category": category,
                    "chapter": chapter_id,
                    "chunk_index": None,
                    "text": chapter_text.strip()
                })

    return documents


def main():

    # Load original book data
    with open(INPUT_FILE, "r", encoding="utf-8") as file:
        books = json.load(file)

    # Extract documents
    documents = extract_documents(books)

    # Save extracted documents
    with open(OUTPUT_FILE, "w", encoding="utf-8") as file:
        json.dump(documents, file, ensure_ascii=False, indent=2)

    # Display summary
    print("\n===== EXTRACTION SUMMARY =====")
    print(f"Total books: {len(books)}")
    print(f"Total documents: {len(documents)}")

    # Display a few examples
    print("\n===== SAMPLE DOCUMENTS =====")

    for document in documents[:3]:
        print(f"\nDocument ID: {document['doc_id']}")
        print(f"Book title: {document['title']}")
        print(f"Chapter: {document['chapter']}")
        print(f"Text: {document['text'][:200]}...")

    print(f"\nOutput saved to: {OUTPUT_FILE}")


if __name__ == "__main__":
    main()
