-- Enable PgVector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Create service schemas
CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS book;
CREATE SCHEMA IF NOT EXISTS knowledge;

-- Table for dense & sparse chunk storage and retrieval
-- Compatible with BAAI/bge-small-en-v1.5 (dimension 384)
CREATE TABLE IF NOT EXISTS knowledge.chunks (
  id          BIGSERIAL PRIMARY KEY,
  book_id     TEXT NOT NULL,
  chapter_no  INT NOT NULL DEFAULT 1,
  chunk_no    INT NOT NULL DEFAULT 1,
  content     TEXT NOT NULL,
  embedding   vector(384)
);

-- HNSW vector similarity index for dense retrieval
CREATE INDEX IF NOT EXISTS chunks_embedding_idx
  ON knowledge.chunks USING hnsw (embedding vector_cosine_ops);

-- Full-text GIN index for sparse BM25 / text search
CREATE INDEX IF NOT EXISTS chunks_content_tsv_idx
  ON knowledge.chunks USING gin (to_tsvector('english', content));

-- Table for inverted index terms (optional dedicated sparse index listing)
CREATE TABLE IF NOT EXISTS knowledge.inverted_index (
  term        TEXT NOT NULL,
  chunk_id    BIGINT NOT NULL REFERENCES knowledge.chunks(id) ON DELETE CASCADE,
  tf_idf      DOUBLE PRECISION NOT NULL DEFAULT 0.0,
  bm25_score  DOUBLE PRECISION NOT NULL DEFAULT 0.0,
  PRIMARY KEY (term, chunk_id)
);

CREATE INDEX IF NOT EXISTS inverted_index_term_idx ON knowledge.inverted_index(term);
