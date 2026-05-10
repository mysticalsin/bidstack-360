-- BidStack 360° — Postgres schema
-- All tenant tables are scoped by org_id. Add Clerk org-id to every query via middleware.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE orgs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_org   text UNIQUE NOT NULL,
  name        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  clerk_user  text UNIQUE NOT NULL,
  email       citext UNIQUE NOT NULL,
  name        text,
  role        text NOT NULL DEFAULT 'member',
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE opportunities (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  code         text NOT NULL,
  customer     text NOT NULL,
  name         text NOT NULL,
  stage        text NOT NULL CHECK (stage IN ('discovery','qualified','proposal','negotiation','closed_won','closed_lost')),
  value_eur    numeric(14,2) NOT NULL DEFAULT 0,
  probability  int NOT NULL DEFAULT 0,
  due_date     date,
  owner_id     uuid REFERENCES users(id),
  industry     text,
  logo_url     text,
  intel        jsonb NOT NULL DEFAULT '{}',  -- financials, triggers, news, hiring, winPrediction
  dust_doc_id  text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, code)
);
CREATE INDEX opps_org_stage_idx ON opportunities (org_id, stage);
CREATE INDEX opps_search_idx ON opportunities USING gin (
  (coalesce(customer,'') || ' ' || coalesce(name,'') || ' ' || coalesce(code,'')) gin_trgm_ops
);

CREATE TABLE contacts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  customer     text NOT NULL,
  name         text NOT NULL,
  role         text,
  email        citext,
  phone        text,
  influence    int,
  sentiment    text CHECK (sentiment IN ('hot','warm','neutral','cold')),
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tasks (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  opp_id       uuid REFERENCES opportunities(id) ON DELETE CASCADE,
  title        text NOT NULL,
  due_date     date,
  status       text NOT NULL DEFAULT 'open',
  assignee_id  uuid REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE documents (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  opp_id       uuid REFERENCES opportunities(id) ON DELETE CASCADE,
  name         text NOT NULL,
  kind         text NOT NULL,        -- rfp | sow | proposal | qa | reference
  storage_url  text NOT NULL,
  dust_doc_id  text,
  bytes        bigint,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sync_events (
  id           bigserial PRIMARY KEY,
  org_id       uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  source       text NOT NULL,        -- dust.webhook | dust.poll | mcp | manual
  event_type   text NOT NULL,
  payload      jsonb NOT NULL,
  status       text NOT NULL DEFAULT 'received',
  error        text,
  received_at  timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);
CREATE INDEX sync_events_org_received_idx ON sync_events (org_id, received_at DESC);

CREATE TABLE api_keys (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  name         text NOT NULL,
  hashed_key   text NOT NULL,
  prefix       text NOT NULL,        -- first 8 chars, displayed
  scopes       text[] NOT NULL DEFAULT ARRAY['read'],
  last_used_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  revoked_at   timestamptz
);

CREATE TABLE webhook_subscriptions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  url          text NOT NULL,
  secret       text NOT NULL,
  events       text[] NOT NULL,
  active       boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_log (
  id           bigserial PRIMARY KEY,
  org_id       uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  user_id      uuid REFERENCES users(id),
  action       text NOT NULL,
  target_type  text,
  target_id    text,
  diff         jsonb,
  at           timestamptz NOT NULL DEFAULT now()
);
