-- Crew infrastructure (CrewAI-style multi-agent) — Wave 10.
-- Admin-managed agent personas + crews; regular users only RUN them.
-- Accessed via parameterized raw SQL until the Prisma client is regenerated
-- (Windows DLL lock) — mirrors the Wave 9 RFP models. FKs to orgs are enforced
-- here at the DB layer rather than via Prisma relations.

-- ── crew_agents: reusable role personas (legal / finance / marketing / …) ──
CREATE TABLE IF NOT EXISTS "crew_agents" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "org_id" UUID NOT NULL,
  "agent_key" VARCHAR(100) NOT NULL,
  "role" TEXT NOT NULL,
  "goal" TEXT NOT NULL,
  "backstory" TEXT NOT NULL,
  "tools" JSONB NOT NULL DEFAULT '[]',
  "is_standard" BOOLEAN NOT NULL DEFAULT false,
  "created_by_user_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "deleted_at" TIMESTAMPTZ(6),
  CONSTRAINT "crew_agents_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "crew_agents_org_fk" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE
);
-- Unique key per org, ignoring soft-deleted rows so a key can be re-used.
CREATE UNIQUE INDEX IF NOT EXISTS "crew_agents_org_key_key"
  ON "crew_agents"("org_id", "agent_key") WHERE "deleted_at" IS NULL;
CREATE INDEX IF NOT EXISTS "crew_agents_org_idx" ON "crew_agents"("org_id");
CREATE INDEX IF NOT EXISTS "crew_agents_deleted_idx" ON "crew_agents"("deleted_at");

-- ── crews: a named team with a process (sequential | hierarchical) ──
CREATE TABLE IF NOT EXISTS "crews" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "org_id" UUID NOT NULL,
  "name" VARCHAR(200) NOT NULL,
  "description" TEXT,
  "process" VARCHAR(20) NOT NULL DEFAULT 'sequential',
  "manager_agent_key" VARCHAR(100),
  "created_by_user_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "deleted_at" TIMESTAMPTZ(6),
  CONSTRAINT "crews_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "crews_org_fk" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "crews_org_idx" ON "crews"("org_id");
CREATE INDEX IF NOT EXISTS "crews_deleted_idx" ON "crews"("deleted_at");

-- ── crew_tasks: ordered units of work, each owned by an agent_key ──
CREATE TABLE IF NOT EXISTS "crew_tasks" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "org_id" UUID NOT NULL,
  "crew_id" UUID NOT NULL,
  "task_key" VARCHAR(100) NOT NULL,
  "description" TEXT NOT NULL,
  "expected_output" TEXT NOT NULL,
  "agent_key" VARCHAR(100) NOT NULL,
  "context_keys" JSONB NOT NULL DEFAULT '[]',
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "crew_tasks_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "crew_tasks_crew_fk" FOREIGN KEY ("crew_id") REFERENCES "crews"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "crew_tasks_crew_key_key" ON "crew_tasks"("crew_id", "task_key");
CREATE INDEX IF NOT EXISTS "crew_tasks_org_idx" ON "crew_tasks"("org_id");
CREATE INDEX IF NOT EXISTS "crew_tasks_crew_sort_idx" ON "crew_tasks"("crew_id", "sort_order");

-- ── crew_runs: one execution of a crew (kickoff result) ──
CREATE TABLE IF NOT EXISTS "crew_runs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "org_id" UUID NOT NULL,
  "crew_id" UUID NOT NULL,
  "started_by_user_id" UUID,
  "status" VARCHAR(20) NOT NULL DEFAULT 'queued',
  "inputs" JSONB NOT NULL DEFAULT '{}',
  "final_output" TEXT,
  "results" JSONB,
  "error" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "completed_at" TIMESTAMPTZ(6),
  CONSTRAINT "crew_runs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "crew_runs_org_fk" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE,
  CONSTRAINT "crew_runs_crew_fk" FOREIGN KEY ("crew_id") REFERENCES "crews"("id") ON DELETE CASCADE
);
-- Owner-scoping index (regular users see only their own runs).
CREATE INDEX IF NOT EXISTS "crew_runs_org_owner_idx" ON "crew_runs"("org_id", "started_by_user_id");
CREATE INDEX IF NOT EXISTS "crew_runs_crew_idx" ON "crew_runs"("crew_id");
