CREATE EXTENSION IF NOT EXISTS vector;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS book;
CREATE SCHEMA IF NOT EXISTS knowledge;

CREATE TABLE IF NOT EXISTS knowledge.chunks (
  id        BIGSERIAL PRIMARY KEY,
  book_id   TEXT NOT NULL,        -- plain id, no foreign key into the book schema
  content   TEXT NOT NULL,
  embedding vector(1536)          -- must match your embedding model's dimension
);

CREATE INDEX IF NOT EXISTS chunks_embedding_idx
  ON knowledge.chunks USING hnsw (embedding vector_cosine_ops);