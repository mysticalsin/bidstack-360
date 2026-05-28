-- Wave 9: RFP Automation Engine — pgvector HNSW indexes
-- Run AFTER the Prisma migration that creates reference_embeddings and requirement_embeddings.
-- Prisma cannot express HNSW operator class syntax natively — this must run as a separate step.
-- Production: run via psql or migrate.sql in the deployment pipeline.

-- Enable pgvector extension (idempotent)
CREATE EXTENSION IF NOT EXISTS vector;

-- HNSW index on reference_embeddings (success stories)
-- m=16, ef_construction=128: balanced for recall/build-time at corpus size < 100K stories.
-- WHY HNSW over IVFFlat: HNSW has no training phase, supports live inserts without reindex.
CREATE INDEX IF NOT EXISTS reference_embeddings_org_vec_hnsw
  ON reference_embeddings
  USING hnsw (vector vector_cosine_ops)
  WITH (m = 16, ef_construction = 128);

-- HNSW index on requirement_embeddings (per-RFP extracted requirements)
-- Smaller corpus per run; HNSW still preferred for consistency and live inserts.
CREATE INDEX IF NOT EXISTS requirement_embeddings_org_vec_hnsw
  ON requirement_embeddings
  USING hnsw (vector vector_cosine_ops)
  WITH (m = 16, ef_construction = 128);

-- Composite index for org-scoped vector queries (WHERE org_id = $1 ORDER BY vector <=> $2)
CREATE INDEX IF NOT EXISTS reference_embeddings_org_id_idx
  ON reference_embeddings (org_id);

CREATE INDEX IF NOT EXISTS requirement_embeddings_org_id_idx
  ON requirement_embeddings (org_id);
