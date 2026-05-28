-- Wave 9: RFP Automation Engine — base tables + pgvector HNSW indexes
--
-- WHY this migration is hand-authored:
--   1. pnpm db:generate cannot run on Windows while the API server holds the Prisma .dll lock.
--   2. Prisma cannot express HNSW operator class syntax (vector_cosine_ops, m, ef_construction).
--
-- All CREATE TABLE statements are derived directly from schema.prisma Wave 9 models.
-- Run in order: CREATE TYPE → CREATE TABLE → CREATE INDEX.
-- Production: run via psql or the deployment pipeline migrate.sql step.

-- ─── pgvector extension (idempotent) ─────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS vector;

-- ─── Enum types ───────────────────────────────────────────────────────────────

-- WHY values match spec contract {running, completed, failed, paused, approved}
-- plus operational states {queued, rejected} for pre-start and human-rejection paths.
DO $$ BEGIN
  CREATE TYPE "RfpOrchestrationState" AS ENUM (
    'queued', 'running', 'paused', 'approved', 'rejected', 'completed', 'failed'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- WHY values match rfp-orchestrator.ts (writes 'requirement_extract') and spec contract.
-- Broader pipeline phases (legal_scan, qa_review, human_approval) added when those workers ship.
DO $$ BEGIN
  CREATE TYPE "RfpResponsePhase" AS ENUM (
    'requirement_extract', 'story_match', 'section_draft', 'compliance_fill', 'completed'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── rfp_orchestrations ───────────────────────────────────────────────────────
-- State machine row per (org_id, rfp_request_id).
-- uniq_org_rfp_active prevents duplicate pipeline launches and makes upsert safe.
CREATE TABLE IF NOT EXISTS rfp_orchestrations (
  id                  UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id              UUID        NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  rfp_request_id      TEXT        NOT NULL,
  document_version_id UUID        NOT NULL,
  opportunity_id      UUID,
  proposal_id         UUID,
  started_by_user_id  UUID,
  state               "RfpOrchestrationState" NOT NULL DEFAULT 'queued',
  current_phase       "RfpResponsePhase",
  completed_phases    TEXT[]      NOT NULL DEFAULT '{}',
  failed_phase        "RfpResponsePhase",
  failure_reason      TEXT,
  root_job_id         VARCHAR(200),
  config              JSONB       NOT NULL DEFAULT '{}',
  started_at          TIMESTAMPTZ,
  completed_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at          TIMESTAMPTZ,

  CONSTRAINT uniq_org_rfp_active UNIQUE (org_id, rfp_request_id)
);

CREATE INDEX IF NOT EXISTS rfp_orchestrations_org_state_idx
  ON rfp_orchestrations (org_id, state);

CREATE INDEX IF NOT EXISTS rfp_orchestrations_root_job_id_idx
  ON rfp_orchestrations (root_job_id);

CREATE INDEX IF NOT EXISTS rfp_orchestrations_deleted_at_idx
  ON rfp_orchestrations (deleted_at);

-- ─── requirement_reference_matches ────────────────────────────────────────────
-- Hybrid semantic match result between an RFP requirement and a success story.
-- WHY (org_id, requirement_id, reference_id): org_id in the unique key prevents
-- cross-org data pollution on the ON CONFLICT path in rfp-story-match.ts.
CREATE TABLE IF NOT EXISTS requirement_reference_matches (
  id               UUID         NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id           UUID         NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  requirement_id   UUID         NOT NULL,
  reference_id     UUID         NOT NULL,
  score_bps        INTEGER      NOT NULL,
  rank             INTEGER      NOT NULL,
  reasoning        TEXT,
  which_fields     TEXT[]       NOT NULL DEFAULT '{}',
  matched_by_agent VARCHAR(100) NOT NULL,
  agent_run_id     UUID,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  deleted_at       TIMESTAMPTZ,

  CONSTRAINT requirement_reference_matches_org_req_ref_key
    UNIQUE (org_id, requirement_id, reference_id)
);

CREATE INDEX IF NOT EXISTS req_ref_matches_org_req_idx
  ON requirement_reference_matches (org_id, requirement_id);

CREATE INDEX IF NOT EXISTS req_ref_matches_org_ref_idx
  ON requirement_reference_matches (org_id, reference_id);

CREATE INDEX IF NOT EXISTS req_ref_matches_deleted_at_idx
  ON requirement_reference_matches (deleted_at);

-- ─── reference_embeddings ────────────────────────────────────────────────────
-- One embedding row per Reference (success story). HNSW index at the bottom.
-- content_hash enables skip-re-embedding when the source text is unchanged.
CREATE TABLE IF NOT EXISTS reference_embeddings (
  id           UUID         NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id       UUID         NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  reference_id UUID         NOT NULL UNIQUE,
  model        VARCHAR(100) NOT NULL,
  dim          INTEGER      NOT NULL,
  vector       vector(1024) NOT NULL,
  content_hash VARCHAR(64)  NOT NULL,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- ─── requirement_embeddings ──────────────────────────────────────────────────
-- One embedding row per extracted Requirement. HNSW index at the bottom.
CREATE TABLE IF NOT EXISTS requirement_embeddings (
  id             UUID         NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id         UUID         NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  requirement_id UUID         NOT NULL UNIQUE,
  model          VARCHAR(100) NOT NULL,
  dim            INTEGER      NOT NULL,
  vector         vector(1024) NOT NULL,
  content_hash   VARCHAR(64)  NOT NULL,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- ─── ai_invocations ──────────────────────────────────────────────────────────
-- EU AI Act Art. 50 + GDPR Art. 22 audit log per AI agent call.
-- Prompts/responses stored as SHA-256 hashes only — never full text.
-- 90-day retention enforced by scheduled cleanup job (rfp.audit-cleanup).
CREATE TABLE IF NOT EXISTS ai_invocations (
  id               UUID         NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id           UUID         NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  user_id          UUID,
  agent_type       VARCHAR(100) NOT NULL,
  model            VARCHAR(100) NOT NULL,
  prompt_hash      VARCHAR(64)  NOT NULL,
  prompt_snippet   VARCHAR(200),
  response_hash    VARCHAR(64)  NOT NULL,
  response_snippet VARCHAR(200),
  token_count      INTEGER      NOT NULL,
  duration_ms      INTEGER      NOT NULL,
  status           VARCHAR(20)  NOT NULL,
  error_msg        TEXT,
  trace_id         VARCHAR(100),
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_invocations_org_agent_idx
  ON ai_invocations (org_id, agent_type);

CREATE INDEX IF NOT EXISTS ai_invocations_org_created_idx
  ON ai_invocations (org_id, created_at);

CREATE INDEX IF NOT EXISTS ai_invocations_trace_id_idx
  ON ai_invocations (trace_id);

-- Composite index for org-scoped vector queries (WHERE org_id = $1 ORDER BY vector <=> $2)
CREATE INDEX IF NOT EXISTS reference_embeddings_org_id_idx
  ON reference_embeddings (org_id);

CREATE INDEX IF NOT EXISTS requirement_embeddings_org_id_idx
  ON requirement_embeddings (org_id);

-- ─── HNSW vector indexes ─────────────────────────────────────────────────────
-- WHY HNSW over IVFFlat: no training phase, supports live inserts without reindex.
-- m=16 ef_construction=128: calibrated for recall/build-time at corpus < 100K.
--   m=16   → 16 bi-directional connections per node (good recall, manageable size)
--   ef=128 → search queue width during construction (above the QA minimum of 64)

-- HNSW index on reference_embeddings (success stories)
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

