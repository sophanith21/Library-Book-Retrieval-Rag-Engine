# pip install nltk - for stop words

import re
import nltk
import json 

from pathlib import Path
from nltk.corpus import stopwords
from nltk.stem import PorterStemmer, SnowballStemmer, WordNetLemmatizer

porter = PorterStemmer()
snowball = SnowballStemmer("english")
lemmatizer = WordNetLemmatizer()


BASE_DIR = Path(__file__).resolve().parent
NLTK_DATA_DIR = BASE_DIR / "nltk_data"
print("Base dir: ", BASE_DIR)

nltk.data.path.append(str(NLTK_DATA_DIR))

STOP_WORDS = set(stopwords.words("english"))

def tokenize(text):
  """
  Convert text into lowercase word tokens.
  """
  return re.findall(r"[a-z]+|\d+", text.lower())

def remove_stop_words(tokens):
  return [
      token for token in tokens
      if token not in STOP_WORDS
  ]

def porter_stems(tokens):
  return [porter.stem(token) for token in tokens]

def snowball_stems(tokens):
  return [snowball.stem(token) for token in tokens]

def lemmatize_tokens(tokens):
  return[lemmatizer.lemmatize(token, pos="n") for token in tokens]

def pre_process(text, method="lemmatization"):
  tokens = tokenize(text)
  tokens = remove_stop_words(tokens)
  if method == "porter":
    normalized_tokens = porter_stems(tokens)

  elif method == "snowball":
    normalized_tokens = snowball_stems(tokens)

  elif method == "lemmatization":
    normalized_tokens = lemmatize_tokens(tokens)

  else:
    raise ValueError(
        "Invalid method. Choose porter, snowball, or lemmatization."
    )

  return normalized_tokens 


def process_documents(documents, method="lemmatization"):
    """
    Apply the selected preprocessing configuration to every document.
    Default: lemmatization.
    """

    processed_documents = []

    for document in documents:
        text = document.get("text", "")

        # Basic preprocessing
        tokens = pre_process(text)

        # Select normalization method
        if method == "porter":
            normalized_tokens = porter_stems(tokens)

        elif method == "snowball":
            normalized_tokens = snowball_stems(tokens)

        elif method == "lemmatization":
            normalized_tokens = lemmatize_tokens(tokens)

        else:
            raise ValueError(
                "Invalid method. Choose porter, snowball, or lemmatization."
            )

        processed_document = {
            **document,
            "tokens": tokens,
            "normalized_tokens": normalized_tokens
        }

        processed_documents.append(processed_document)

    return processed_documents
if __name__ == "__main__":

    INPUT_FILE = (
      BASE_DIR / "ranking-evaluation"
      / "sampled-data" / "data" / "documents.json"
    )

    OUTPUT_FILE = (
      BASE_DIR / "ranking-evaluation"
      / "sampled-data" / "data" / "processed-documents.json"
    )

    # Load original documents
    with open(INPUT_FILE, "r", encoding="utf-8") as file:
        documents = json.load(file)

    # Process all documents
    processed_documents = process_documents(documents)

    # Save processed documents
    with open(OUTPUT_FILE, "w", encoding="utf-8") as file:
        json.dump(
            processed_documents,
            file,
            ensure_ascii=False,
            indent=2
        )

    print("===== PREPROCESSING SUMMARY =====")
    print(f"Total documents: {len(documents)}")
    print(f"Processed documents: {len(processed_documents)}")
    print(f"Output saved to: {OUTPUT_FILE}")

    # Display one sample
    if processed_documents:
        sample = processed_documents[0]

        print("\n===== SAMPLE RESULT =====")
        print("Original text:", sample["text"][:200])
        print("Basic tokens:", sample["tokens"][:20])
        print("Porter:", sample["porter_tokens"][:20])
        print("Snowball:", sample["snowball_tokens"][:20])
        print("Lemmatization:", sample["lemmatized_tokens"][:20])

