-- Enable PgVector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Create service schemas
CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS book;
CREATE SCHEMA IF NOT EXISTS knowledge;

-- =============================================================================
-- knowledge.chunks — the "documents" of the inverted index
-- =============================================================================
-- Each chunk is a window of text from one chapter of one book. Chunks are the
-- unit that BM25 scores; a book's rank = best chunk score, and the best chunk
-- supplies the Google-style preview snippet.
--
-- book_id references book.books(id). No FK on purpose: book.* is owned by
-- Prisma migrations (Book service), knowledge.* by the Indexing service, and
-- this file runs before Prisma migrations on a fresh volume.
--
-- Compatible with BAAI/bge-small-en-v1.5 (dimension 384)
CREATE TABLE IF NOT EXISTS knowledge.chunks (
  id          BIGSERIAL PRIMARY KEY,
  book_id     TEXT NOT NULL,
  chapter_no  INT  NOT NULL DEFAULT 1,
  chunk_no    INT  NOT NULL DEFAULT 1,
  content     TEXT NOT NULL,            -- original text; snippet offsets point into this
  token_count INT  NOT NULL DEFAULT 0,  -- |d| for BM25 length normalisation (indexed tokens, after stopword removal)
  embedding   vector(384),
  UNIQUE (book_id, chapter_no, chunk_no)
);

CREATE INDEX IF NOT EXISTS chunks_book_idx ON knowledge.chunks (book_id);

-- HNSW vector similarity index for dense retrieval
CREATE INDEX IF NOT EXISTS chunks_embedding_idx
  ON knowledge.chunks USING hnsw (embedding vector_cosine_ops);

-- Postgres built-in full-text index. Not used by the custom BM25 index below;
-- kept as a baseline to compare relevance against during evaluation.
CREATE INDEX IF NOT EXISTS chunks_content_tsv_idx
  ON knowledge.chunks USING gin (to_tsvector('english', content));

-- =============================================================================
-- knowledge.terms — the dictionary (vocabulary)
-- =============================================================================
-- One row per normalised term (lowercased, stemmed). Storing an integer id
-- keeps the postings table small: ~1,000 books means tens of millions of
-- postings, and repeating the term text in each one would bloat it.
CREATE TABLE IF NOT EXISTS knowledge.terms (
  id              SERIAL PRIMARY KEY,
  term            TEXT   NOT NULL UNIQUE,
  doc_freq        INT    NOT NULL DEFAULT 0,  -- df: number of chunks containing the term (BM25 IDF)
  collection_freq BIGINT NOT NULL DEFAULT 0,  -- total occurrences across the corpus
  idf             DOUBLE PRECISION            -- cached BM25 IDF; filled by refresh_index_stats()
);

-- =============================================================================
-- knowledge.postings — the inverted index itself
-- =============================================================================
-- One row per (term, chunk) pair. Postings for a term are physically grouped
-- by the primary key, so "fetch the postings list for term X" is one index
-- range scan.
--
--   positions   token positions within the chunk (0-based, after tokenisation).
--               Used for phrase queries ("white whale") and proximity.
--   char_starts / char_ends
--               character offsets in chunks.content of each occurrence,
--               parallel to positions. The snippet generator uses these to
--               cut a window around the densest hit cluster and wrap
--               matches in <mark> without re-tokenising the chunk at query time.
--   bm25_weight precomputed BM25 term weight for this posting, so a query is
--               SUM(bm25_weight) GROUP BY chunk_id. Filled by refresh_index_stats().
CREATE TABLE IF NOT EXISTS knowledge.postings (
  term_id     INT    NOT NULL REFERENCES knowledge.terms(id)  ON DELETE CASCADE,
  chunk_id    BIGINT NOT NULL REFERENCES knowledge.chunks(id) ON DELETE CASCADE,
  book_id     TEXT   NOT NULL,           -- denormalised so book-level grouping skips a join
  term_freq   INT    NOT NULL,           -- tf
  positions   INT[]  NOT NULL,
  char_starts INT[]  NOT NULL,
  char_ends   INT[]  NOT NULL,
  bm25_weight REAL,
  PRIMARY KEY (term_id, chunk_id),
  CHECK (term_freq = cardinality(positions)),
  CHECK (cardinality(positions) = cardinality(char_starts)),
  CHECK (cardinality(char_starts) = cardinality(char_ends))
);

-- Reverse lookup: needed for ON DELETE CASCADE when a book is re-indexed or removed.
CREATE INDEX IF NOT EXISTS postings_chunk_idx ON knowledge.postings (chunk_id);

-- =============================================================================
-- knowledge.index_stats — corpus-wide statistics for BM25
-- =============================================================================
-- Single row. N and avgdl change only when books are (re)indexed, so they are
-- cached here instead of being recomputed on every query.
CREATE TABLE IF NOT EXISTS knowledge.index_stats (
  id             BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),  -- enforces a single row
  total_chunks   BIGINT           NOT NULL DEFAULT 0,  -- N
  total_books    INT              NOT NULL DEFAULT 0,
  avg_chunk_len  DOUBLE PRECISION NOT NULL DEFAULT 0,  -- avgdl
  bm25_k1        DOUBLE PRECISION NOT NULL DEFAULT 1.2,
  bm25_b         DOUBLE PRECISION NOT NULL DEFAULT 0.75,
  updated_at     TIMESTAMPTZ      NOT NULL DEFAULT now()
);
INSERT INTO knowledge.index_stats (id) VALUES (TRUE) ON CONFLICT DO NOTHING;

-- =============================================================================
-- knowledge.indexed_books — per-book indexing status
-- =============================================================================
-- Makes bulk indexing of ~1,000 EPUBs resumable and idempotent: skip books
-- already 'done', retry 'failed' ones, and record parse errors for the
-- "formatting variance" risk called out in the proposal.
--
-- title/author are copied from the indexing payload so search results can be
-- rendered without a cross-service call; book.books stays the source of truth.
CREATE TABLE IF NOT EXISTS knowledge.indexed_books (
  book_id      TEXT PRIMARY KEY,
  title        TEXT,
  author       TEXT,
  status       TEXT NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending', 'indexing', 'done', 'failed')),
  chunk_count  INT  NOT NULL DEFAULT 0,
  token_count  BIGINT NOT NULL DEFAULT 0,
  error        TEXT,
  indexed_at   TIMESTAMPTZ
);

-- =============================================================================
-- knowledge.refresh_index_stats() — finalise the index after a bulk load
-- =============================================================================
-- Call once after indexing a batch of books (not per book):
--   SELECT knowledge.refresh_index_stats();
-- Recomputes df, N, avgdl, IDF and every posting's BM25 weight:
--   idf(t)    = ln(1 + (N - df + 0.5) / (df + 0.5))
--   weight    = idf * tf * (k1 + 1) / (tf + k1 * (1 - b + b * |d| / avgdl))
CREATE OR REPLACE FUNCTION knowledge.refresh_index_stats()
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_n     BIGINT;
  v_avgdl DOUBLE PRECISION;
  v_k1    DOUBLE PRECISION;
  v_b     DOUBLE PRECISION;
BEGIN
  SELECT count(*), coalesce(avg(token_count), 0)
    INTO v_n, v_avgdl
    FROM knowledge.chunks;

  UPDATE knowledge.index_stats
     SET total_chunks  = v_n,
         total_books   = (SELECT count(DISTINCT book_id) FROM knowledge.chunks),
         avg_chunk_len = v_avgdl,
         updated_at    = now()
   RETURNING bm25_k1, bm25_b INTO v_k1, v_b;

  -- Document / collection frequency per term
  UPDATE knowledge.terms t
     SET doc_freq        = s.df,
         collection_freq = s.cf,
         idf             = ln(1 + (v_n - s.df + 0.5) / (s.df + 0.5))
    FROM (SELECT term_id, count(*) AS df, sum(term_freq) AS cf
            FROM knowledge.postings
           GROUP BY term_id) s
   WHERE t.id = s.term_id;

  -- Drop terms no longer referenced by any posting (e.g. after a book was removed)
  DELETE FROM knowledge.terms t
   WHERE NOT EXISTS (SELECT 1 FROM knowledge.postings p WHERE p.term_id = t.id);

  -- Per-posting BM25 weight
  IF v_avgdl > 0 THEN
    UPDATE knowledge.postings p
       SET bm25_weight = t.idf * p.term_freq * (v_k1 + 1)
                         / (p.term_freq + v_k1 * (1 - v_b + v_b * c.token_count / v_avgdl))
      FROM knowledge.terms t, knowledge.chunks c
     WHERE t.id = p.term_id
       AND c.id = p.chunk_id;
  END IF;
END;
$$;
