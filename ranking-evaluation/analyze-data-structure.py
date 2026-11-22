
import json
import pandas as pd
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
INPUT_FILE = BASE_DIR / "sampled-data" / "data" / "data-sample.json"

# Load JSON data
with open(INPUT_FILE, "r", encoding="utf-8") as file:
    data = json.load(file)

# Convert JSON into a DataFrame
df = pd.json_normalize(data, sep=".")

# Missing values
print("\n===== MISSING VALUES =====")
print(df.isnull().sum().to_string())

# Data types
print("\n===== DATA TYPES =====")
print(df.dtypes.to_string())
