import sys
from pathlib import Path
import math
import json



BASE_DIR = Path(__file__).resolve().parent.parent
print("Base Dir: ", BASE_DIR)

sys.path.append(str(BASE_DIR))
from text_preprocessing import pre_process
from prepare_data import load_books, extract_documents
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity

books = load_books()  
documents = extract_documents(books)
doc_tokens = {
    doc["doc_id"]: pre_process(doc["text"])
    for doc in documents
}

doc_len = {
    doc_id: len(tokens)
    for doc_id, tokens in doc_tokens.items()
}

N = len(doc_tokens)
AVGDL = sum(doc_len.values()) / N

def tf(term, doc_id): return doc_tokens[doc_id].count(term)

def df(term): return sum(1 for d in doc_tokens if term in doc_tokens[d])

def idf_bm25(term):
  d = df(term)
  return math.log((N - d + 0.5) / (d + 0.5) + 1)

def bm25_score(query_text, doc_id, k1=1.5, b=0.75):
    terms = set(pre_process(query_text))
    score = 0.0
    dl = doc_len[doc_id]
    for t in terms:
        f = tf(t, doc_id)
        if f == 0: continue
        score += idf_bm25(t) * (f * (k1 + 1)) / (f + k1 * (1 - b + b * dl / AVGDL))
    return score


def rank_bm25(query_text, top_k=10, k1=1.5, b=0.75):
    scored = [
        (doc_id, bm25_score(query_text, doc_id, k1, b))
        for doc_id in doc_tokens
    ]

    scored = [s for s in scored if s[1] > 0]

    ranked = sorted(scored, key=lambda x: -x[1])[:top_k]

    results = []

    for rank, (doc_id, score) in enumerate(ranked, start=1):
        # Find the original document using its doc_id
        document = next(
            doc for doc in documents
            if doc["doc_id"] == doc_id
        )

        results.append({
            "rank": rank,
            "score": score,
            **document
        })

    return results

test_queries = [
    "Christopher Robin",
    "Pooh and Piglet",
    "What happened during the flood?",
    "Pooh finds a boat",
]

evaluation_data = {}

for i, query in enumerate(test_queries, start=1):
    print("\n" + "=" * 80)
    print(f"QUERY: {query}")
    print("=" * 80)

    results = rank_bm25(query, top_k=3)

    # Store the query and its retrieved results
    evaluation_data[f"q{i}"] = {
        "query": query,
        "results": results
    }

    for result in results:
        print(f"\nRank: {result['rank']}")
        print(f"Chunk ID: {result['doc_id']}")
        print(f"Title: {result['title']}")
        print(f"Chapter: {result['chapter']}")
        print(f"BM25 Score: {result['score']:.4f}")
        print(f"Text: {result['text'][:500]}...")

# Save results to queries.json
with open("queries.json", "w", encoding="utf-8") as file:
    json.dump(evaluation_data, file, indent=4, ensure_ascii=False)

print("\nResults saved to queries.json")
