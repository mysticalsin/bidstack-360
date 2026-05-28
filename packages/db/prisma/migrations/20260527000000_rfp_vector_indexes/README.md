# Wave 9: pgvector HNSW Indexes

Manual migration required alongside the Prisma schema migration.

## Steps

1. Ensure `pgvector` extension is available: `SELECT * FROM pg_available_extensions WHERE name = 'vector';`
2. Run this file: `psql $DATABASE_URL -f migration.sql`
3. Verify indexes: `SELECT indexname FROM pg_indexes WHERE tablename IN ('reference_embeddings', 'requirement_embeddings');`

## Why manual?
Prisma 5 cannot express HNSW operator class syntax (`vector_cosine_ops`, `m`, `ef_construction`).
This SQL is idempotent (`CREATE INDEX IF NOT EXISTS`) and safe to re-run.
