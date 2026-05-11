-- Add GIN trigram index for opportunity search
-- This migration is applied manually because Prisma does not support
-- GIN indexes with expression columns natively.

CREATE INDEX IF NOT EXISTS opps_search_gin_idx
ON opportunities USING gin (
  (coalesce(customer,'') || ' ' || coalesce(name,'') || ' ' || coalesce(code,'')) gin_trgm_ops
);
