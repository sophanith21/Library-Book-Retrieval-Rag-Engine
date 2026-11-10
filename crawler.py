import json
import time
from bs4 import BeautifulSoup
import requests

BASE_URL = "https://standardebooks.org/ebooks"
TARGET_COUNT = 1000
OUTPUT_FILE = "epub_links.json"


def crawl_standard_ebooks():
  collected_links = set()
  page = 1

  print("[*] Starting Standard Ebooks crawler...")

  session = requests.Session()
  session.headers.update({
      "User-Agent": (
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) DigitalLibraryProject/1.0"
      )
  })

  while len(collected_links) < TARGET_COUNT:
    url = f"{BASE_URL}?page={page}"
    print(f"[-] Fetching page {page}: {url}")

    try:
      response = session.get(url, timeout=15)
      if response.status_code != 200:
        print(f"[!] Failed to fetch page {page}. Status: {response.status_code}")
        break

      soup = BeautifulSoup(response.text, "html.parser")

      # Find all links on the page
      all_links = soup.find_all("a", href=True)
      page_book_paths = set()

      for tag in all_links:
        href = tag["href"]
        # Standard Ebooks individual book links look like /ebooks/author/title
        # They have at least 3 parts when split by '/' (e.g., ['', 'ebooks', 'author', 'title'])
        parts = href.strip("/").split("/")
        if len(parts) >= 3 and parts[0] == "ebooks":
          # Ensure we are grabbing the main book page, not subpages like /text or /downloads
          clean_path = f"/{parts[0]}/{parts[1]}/{parts[2]}"
          page_book_paths.add(clean_path)

      if not page_book_paths:
        print(
            f"[!] No more books found on page {page}. Reached end of catalog."
        )
        break

      print(f"    [+] Found {len(page_book_paths)} unique books on page {page}.")

      for book_path in page_book_paths:
        book_url = f"https://standardebooks.org{book_path}"
        epub_link = get_direct_epub_link(session, book_url)

        if epub_link and epub_link not in collected_links:
          collected_links.add(epub_link)
          print(
              f"    [+] Collected ({len(collected_links)}/{TARGET_COUNT}):"
              f" {epub_link}"
          )

          if len(collected_links) >= TARGET_COUNT:
            break

      page += 1
      time.sleep(1)  # Polite crawling delay

    except Exception as e:
      print(f"[!] Error during crawling page {page}: {e}")
      break

  with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
    json.dump(list(collected_links), f, indent=2)
  print(f"[*] Done! Saved {len(collected_links)} links to {OUTPUT_FILE}")


def get_direct_epub_link(session, book_page_url):
  """Visits a specific book page and extracts the direct .epub download URL."""
  try:
    res = session.get(session.get(book_page_url) and book_page_url, timeout=5)
    if res.status_code != 200:
      return None
    soup = BeautifulSoup(res.text, "html.parser")

    # Search for any download link ending in .epub
    epub_tag = soup.find(
        "a",
        href=lambda href: href and href.endswith(".epub") and "download" in href,
    )
    if epub_tag:
      href = epub_tag["href"]
      return (
          f"https://standardebooks.org{href}"
          if href.startswith("/")
          else href
      )
  except Exception:
    pass
  return None


if __name__ == "__main__":
  crawl_standard_ebooks()