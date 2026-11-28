
import json
import requests
from pathlib import Path

BASE_URL = "http://localhost:3000"

# Always resolve files relative to this Python script
SCRIPT_DIR = Path(__file__).resolve().parent
RESULTS_DIR = SCRIPT_DIR / "results"

ENDPOINTS = {
    "bm25": {
        "url": f"{BASE_URL}/search",
        "params": {
            "limit": 5,
            "offset": 0
        }
    },
    "dense": {
        "url": f"{BASE_URL}/search/dense",
        "params": {
            "limit": 5,
            "offset": 0,
            "topKChunks": 20
        }
    }
}

# Load queries
with open(SCRIPT_DIR / "queries.json", "r") as file:
    queries = json.load(file)

if not isinstance(queries, list):
    raise ValueError("queries.json must contain a list")

if not all(isinstance(item, dict) for item in queries):
    raise ValueError("Each query must be an object with query_id and text")

print(f"Loaded {len(queries)} queries")

RESULTS_DIR.mkdir(exist_ok=True)


def execute_search(endpoint, query):
    params = {
        **endpoint["params"],
        "q": query
    }

    response = requests.get(
        endpoint["url"],
        params=params,
        timeout=120
    )

    response.raise_for_status()
    return response.json()


for system, endpoint in ENDPOINTS.items():
    results = {}

    for item in queries:
        query_id = item["query_id"]
        query_text = item["text"]

        print(f"[{system}] Running {query_id}: {query_text}")

        try:
            api_result = execute_search(endpoint, query_text)

            results[query_id] = {
                "query": query_text,
                "response": api_result
            }

        except requests.RequestException as error:
            print(f"Error on {query_id}: {error}")

    output_file = RESULTS_DIR / f"{system}_results.json"

    with open(output_file, "w") as file:
        json.dump(results, file, indent=2, ensure_ascii=False)

    print(f"Saved: {output_file}")

print("Retrieval completed!")
