import sys
from pathlib import Path
import math


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


