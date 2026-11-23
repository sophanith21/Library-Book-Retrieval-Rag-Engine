import math
import json

def precision_at_k(ranked_ids, relevant, k):
    top_k = ranked_ids[:k]

    relevant_count = sum(
        1 for doc_id in top_k
        if relevant.get(doc_id, 0) > 0
    )

    return relevant_count / k


def recall_at_k(ranked_ids, relevant, k):
    top_k = ranked_ids[:k]

    relevant_count = sum(
        1 for doc_id in top_k
        if relevant.get(doc_id, 0) > 0
    )

    total_relevant = sum(
        1 for grade in relevant.values()
        if grade > 0
    )

    if total_relevant == 0:
        return 0.0

    return relevant_count / total_relevant


def f1_score(precision, recall):
    if precision + recall == 0:
        return 0.0

    return 2 * precision * recall / (precision + recall)


def average_precision(ranked_ids, relevant):
    hit = 0
    ap_sum = 0.0

    total_relevant = sum(
        1 for grade in relevant.values()
        if grade > 0
    )

    if total_relevant == 0:
        return 0.0

    for rank, doc_id in enumerate(ranked_ids, start=1):
        if relevant.get(doc_id, 0) > 0:
            hit += 1
            ap_sum += hit / rank

    return ap_sum / total_relevant


def mean_average_precision(ap_scores):
    if not ap_scores:
        return 0.0

    return sum(ap_scores) / len(ap_scores)

def dcg(relevances):
    dcg = 0
    for i, rel in enumerate(relevances):
        dcg += (2**rel - 1)/math.log2(i + 2)
    return dcg

def ndcg(ranked_ids, rel_map, k=10):
    relevances = []

    for doc_id in ranked_ids[:k]:
        grades = rel_map.get(doc_id, 0)
        relevances.append(grades)

    ideal = sorted(rel_map.values(), reverse=True)[:k]

    actual_dcg = dcg(relevances)
    ideal_dcg = dcg(ideal)

    if ideal_dcg == 0:
        return 0.0, relevances, ideal, actual_dcg, ideal_dcg

    score = actual_dcg / ideal_dcg

    return score, relevances, ideal, actual_dcg, ideal_dcg

graded_relevance = {
    "HIGHLY_RELEVANT": 3,
    "USEFUL": 2,
    "SOMEWHAT_RELEVANT": 1,
    "NOT_RELEVANT": 0
}


qrels = {
    "q1": {
        "a-a-milne_winnie-the-pooh_ch10_chunk21": 3,
        "a-a-milne_winnie-the-pooh_ch4_chunk7": 3,
        "a-a-milne_winnie-the-pooh_ch12_chunk17": 3
    },
    "q2": {
        "a-a-milne_the-house-at-pooh-corner_ch10_chunk17": 3,
        "a-a-milne_the-house-at-pooh-corner_ch12_chunk20": 3,
        "a-a-milne_winnie-the-pooh_ch8_chunk3": 3
    },
    "q3": {
       "augustine-of-hippo_the-city-of-god_marcus-dods-george-wilson-j-j-smith_ch20_chunk31": 1,
       "augustine-of-hippo_the-city-of-god_marcus-dods-george-wilson-j-j-smith_ch20_chunk30": 0,
       "ambrose-bierce_in-the-midst-of-life_ch20_chunk19": 0 
    },
    "q4": {
       "a-a-milne_winnie-the-pooh_ch12_chunk19": 3,
       "a-a-milne_winnie-the-pooh_ch12_chunk17": 1,
       "a-a-milne_winnie-the-pooh_ch13_chunk5": 0
    }
}

with open("queries.json", "r", encoding="utf-8") as file:
    evaluation_data = json.load(file)

K = 3

precision_scores = []
recall_scores = []
f1_scores = []
ap_scores = []
ndcg_scores = []

for query_id, judgments in qrels.items():

    ranked_ids = [
        doc["doc_id"]
        for doc in evaluation_data[query_id]["results"]
    ]

    # Calculate evaluation metrics
    precision = precision_at_k(ranked_ids, judgments, K)
    recall = recall_at_k(ranked_ids, judgments, K)
    f1 = f1_score(precision, recall)
    ap = average_precision(ranked_ids, judgments)

    score, actual_rels, ideal_rels, actual_dcg, ideal_dcg = ndcg(
        ranked_ids, judgments, k=K
    )

    # Store scores for calculating averages
    precision_scores.append(precision)
    recall_scores.append(recall)
    f1_scores.append(f1)
    ap_scores.append(ap)
    ndcg_scores.append(score)

    # Display individual query results
    print("\n" + "=" * 60)
    print(f"Query: {query_id}")
    print("=" * 60)

    print(f"Precision@{K}: {precision:.4f}")
    print(f"Recall@{K}:    {recall:.4f}")
    print(f"F1@{K}:        {f1:.4f}")
    print(f"AP:            {ap:.4f}")

    print(f"\nActual relevance: {actual_rels}")
    print(f"Ideal relevance:  {ideal_rels}")

    print(f"DCG@{K}:        {actual_dcg:.4f}")
    print(f"IDCG@{K}:       {ideal_dcg:.4f}")
    print(f"NDCG@{K}:       {score:.4f}")


# Calculate overall evaluation metrics
mean_precision = sum(precision_scores) / len(precision_scores)
mean_recall = sum(recall_scores) / len(recall_scores)
mean_f1 = sum(f1_scores) / len(f1_scores)
map_score = mean_average_precision(ap_scores)
mean_ndcg = sum(ndcg_scores) / len(ndcg_scores)


print("\n" + "=" * 60)
print("OVERALL EVALUATION RESULTS")
print("=" * 60)

print(f"Mean Precision@{K}: {mean_precision:.4f}")
print(f"Mean Recall@{K}:    {mean_recall:.4f}")
print(f"Mean F1@{K}:        {mean_f1:.4f}")
print(f"MAP:                {map_score:.4f}")
print(f"Mean NDCG@{K}:      {mean_ndcg:.4f}")