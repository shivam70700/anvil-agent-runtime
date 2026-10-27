-- Migration 002: code_chunks table for Hybrid Search
-- Ensures pgvector is enabled
CREATE EXTENSION IF NOT EXISTS vector;

-- Code chunks table: stores segmented source code with keyword and vector representations
CREATE TABLE IF NOT EXISTS code_chunks (
    id BIGSERIAL PRIMARY KEY,
    repo TEXT NOT NULL,
    file_path TEXT NOT NULL,
    start_line INTEGER NOT NULL,
    end_line INTEGER NOT NULL,
    content TEXT NOT NULL,
    -- PostgreSQL full-text search tsvector (auto-computed from content)
    tsv tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED,
    -- 768-dimensional vector matching Gemini embedding models (e.g. gemini-embedding-001 / text-embedding-004)
    embedding vector(768),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Prevent duplicate chunks when re-indexing the same repository spans
    CONSTRAINT uq_code_chunk_span UNIQUE (repo, file_path, start_line, end_line)
);

-- Fast keyword search index using Generalized Inverted Index (GIN)
CREATE INDEX IF NOT EXISTS idx_code_chunks_tsv ON code_chunks USING GIN(tsv);

-- Index for scoping searches or re-indexing by repo and file
CREATE INDEX IF NOT EXISTS idx_code_chunks_repo_file ON code_chunks(repo, file_path);

-- Vector similarity index using HNSW for fast cosine distance matching (<=>)
CREATE INDEX IF NOT EXISTS idx_code_chunks_embedding ON code_chunks USING hnsw (embedding vector_cosine_ops);
