-- BidStack 360° — PipelineStage backfill migration
-- Creates default Pipeline + PipelineStage rows per org and backfills
-- opportunity.pipeline_stage_id from the legacy OpportunityStage enum column.

-- ─── Step 1: Create a default Pipeline for every org that doesn't have one ───
INSERT INTO "pipelines" ("id", "org_id", "name", "is_default", "archived", "created_at", "updated_at")
SELECT
  gen_random_uuid(),
  o.id,
  'Default Pipeline',
  true,
  false,
  NOW(),
  NOW()
FROM "orgs" o
WHERE NOT EXISTS (
  SELECT 1 FROM "pipelines" p WHERE p.org_id = o.id
);

-- ─── Step 2: Create default PipelineStage rows for every org/pipeline ───
-- We insert the 7 legacy enum values as stages. If a stage key already exists
-- for an org/pipeline, we skip it (idempotent).
WITH legacy_stages (key, name, order_index, probability, forecast_category, is_won, is_lost, color) AS (
  VALUES
    ('s1_lead',              'Lead',               0, 10,  'pipeline',    false, false, '#6366f1'),
    ('s1_ongoing',           'Ongoing',            1, 30,  'pipeline',    false, false, '#8b5cf6'),
    ('s2_sent',              'Proposal Sent',      2, 50,  'best_case',   false, false, '#0ea5e9'),
    ('s3_technical_iteration', 'Technical Iteration', 3, 65,  'commit',      false, false, '#06b6d4'),
    ('s4_negotiation',       'Negotiation',        4, 80,  'commit',      false, false, '#f59e0b'),
    ('closed_won',           'Closed Won',         5, 100, 'closed_won',  true,  false, '#22c55e'),
    ('closed_lost',          'Closed Lost',        6, 0,   'closed_lost', false, true,  '#ef4444')
),
pipeline_orgs AS (
  SELECT p.id AS pipeline_id, p.org_id
  FROM "pipelines" p
)
INSERT INTO "pipeline_stages" (
  "id", "org_id", "pipeline_id", "key", "name", "order_index",
  "probability", "forecast_category", "is_won", "is_lost", "color",
  "archived", "created_at", "updated_at"
)
SELECT
  gen_random_uuid(),
  po.org_id,
  po.pipeline_id,
  ls.key,
  ls.name,
  ls.order_index,
  ls.probability,
  ls.forecast_category,
  ls.is_won,
  ls.is_lost,
  ls.color,
  false,
  NOW(),
  NOW()
FROM pipeline_orgs po
CROSS JOIN legacy_stages ls
WHERE NOT EXISTS (
  SELECT 1
  FROM "pipeline_stages" ps
  WHERE ps.org_id = po.org_id
    AND ps.pipeline_id = po.pipeline_id
    AND ps.key = ls.key
);

-- ─── Step 3: Backfill opportunity.pipeline_stage_id from opportunity.stage ───
UPDATE "opportunities" o
SET "pipeline_stage_id" = ps.id
FROM "pipeline_stages" ps
JOIN "pipelines" p ON p.id = ps.pipeline_id
WHERE o.org_id = p.org_id
  AND ps.key = o.stage::text;

-- ─── Step 4: Verify backfill completeness (should return 0 rows) ───
-- SELECT COUNT(*) FROM "opportunities" WHERE "pipeline_stage_id" IS NULL;
