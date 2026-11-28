
import json
import csv
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent

INPUT_FILE = SCRIPT_DIR / "results" / "bm25_results.json"
OUTPUT_FILE = SCRIPT_DIR / "results" / "bm25_grading.csv"

with open(INPUT_FILE, "r") as file:
    data = json.load(file)

rows = []

for query_id, query_data in data.items():

    query_text = query_data["query"]
    results = query_data["response"]["results"]

    for rank, result in enumerate(results, start=1):

        book_id = result["bookId"]
        chapter_no = result["chapterNo"]
        chunk_no = result["chunkNo"]

        doc_id = (
            f"{book_id}_ch{chapter_no}_chunk{chunk_no}"
        )

        rows.append({
            "query_id": query_id,
            "query": query_text,
            "rank": rank,
            "doc_id": doc_id,
            "title": result["title"],
            "author": result["author"],
            "content": result["snippet"]["text"],
            "relevance": ""
        })

# Export to CSV
with open(OUTPUT_FILE, "w", newline="", encoding="utf-8") as file:

    columns = [
        "query_id",
        "query",
        "rank",
        "doc_id",
        "title",
        "author",
        "content",
        "relevance"
    ]

    writer = csv.DictWriter(file, fieldnames=columns)
    writer.writeheader()
    writer.writerows(rows)

print(f"Exported {len(rows)} candidates to {OUTPUT_FILE}")
