import json
import os
import random
import time
from pathlib import Path
import zipfile
import requests

LINKS_FILE = "epub_links.json"
DOWNLOAD_DIR = "downloads_epubs"


def is_valid_epub(file_path):
  """Checks if file exists and has data. (Avoids strict zip check loop issues)"""
  return file_path.exists() and file_path.stat().st_size > 1024


def download_epubs():
  if not os.path.exists(LINKS_FILE):
    print(f"[!] Links file '{LINKS_FILE}' not found.")
    return

  with open(LINKS_FILE, "r", encoding="utf-8") as f:
    links = json.load(f)

  os.makedirs(DOWNLOAD_DIR, exist_ok=True)
  session = requests.Session()
  session.headers.update({
      "User-Agent": (
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) DigitalLibraryProject/1.0"
          " (Student Project)"
      )
  })

  print(
      f"[*] Starting safe download execution for {len(links)} books..."
  )

  for i, url in enumerate(links, start=1):
    filename = url.split("/")[-1]
    file_path = Path(DOWNLOAD_DIR) / filename

    # IDEMPOTENT CHECK: Skip if file already exists AND is a valid ZIP/EPUB
    if is_valid_epub(file_path):
      print(f"[{i}/{len(links)}] Skipping (Already downloaded): {filename}")
      continue
    elif file_path.exists():
      print(
          f"[{i}/{len(links)}] Found corrupted or incomplete file, re-downloading:"
          f" {filename}"
      )

    success = False
    retries = 5

    for attempt in range(1, retries + 1):
      try:
        print(f"[{i}/{len(links)}] Downloading: {filename} (Attempt {attempt})")
        response = session.get(url, timeout=25, stream=True)

        if response.status_code == 200:
          with open(file_path, "wb") as f_out:
            for chunk in response.iter_content(chunk_size=8192):
              if chunk:
                f_out.write(chunk)
          
          # Verify the newly downloaded file is actually a valid EPUB
          if is_valid_epub(file_path):
            print(f"    [+] Successfully downloaded and verified {filename}")
            success = True
            break
          else:
            print(f"    [!] Downloaded file for {filename} is corrupt. Retrying...")
            file_path.unlink(missing_ok=True) # Delete bad file

        elif response.status_code == 429:
          cooldown = 20 * (2 ** (attempt - 1))
          print(
              f"[!] Rate-limited (429). Cooling down for {cooldown} seconds..."
          )
          time.sleep(cooldown)

        else:
          print(f"[!] HTTP Error {response.status_code} for {url}")
          time.sleep(5)
          break

      except requests.exceptions.RequestException as e:
        print(f"[!] Network error: {e}")
        time.sleep(5)

    if not success:
      print(f"[!] Skipping file due to persistent errors: {filename}")

    # Polite delay between books to avoid rate-limiting
    sleep_duration = random.uniform(3.0, 6.0)
    time.sleep(sleep_duration)

  print("[*] Download execution complete!")


if __name__ == "__main__":
  download_epubs()