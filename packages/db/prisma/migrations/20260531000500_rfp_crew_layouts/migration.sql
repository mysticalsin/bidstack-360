-- Per-workspace RFP crew-board arrangement.
--
-- Stores where the user has dragged each role agent on the crew board
-- (memberKey -> station) so the layout persists across sessions for a given
-- opportunity (the bid workspace). Keyed by (org_id, opportunity_id); the API
-- validates the JSON map against the shared roster before every write, so only
-- known member keys + valid stations are ever stored.
CREATE TABLE IF NOT EXISTS rfp_crew_layouts (
  id             UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id         UUID        NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  opportunity_id UUID        NOT NULL,
  layout         JSONB       NOT NULL DEFAULT '{}',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uniq_org_opportunity_crew_layout UNIQUE (org_id, opportunity_id)
);
