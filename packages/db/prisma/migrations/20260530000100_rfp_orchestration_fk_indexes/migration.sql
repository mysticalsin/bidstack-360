-- rfp_orchestration_fk_indexes
-- Adds composite FK-lookup indexes on rfp_orchestrations so joins to
-- opportunities (org_id, opportunity_id) and proposals (org_id, proposal_id)
-- use an index scan instead of a sequential scan. Idempotent: safe to re-run.
--
-- WHY: RfpOrchestration.opportunityId / proposalId had no supporting index;
-- every join from rfp_orchestrations to opportunities/proposals did a seq scan.
-- Index names match the @@index(map:) entries in schema.prisma so
-- `prisma migrate diff` reports no drift.

CREATE INDEX IF NOT EXISTS rfp_orchestrations_org_opp_idx ON rfp_orchestrations (org_id, opportunity_id);
CREATE INDEX IF NOT EXISTS rfp_orchestrations_org_proposal_idx ON rfp_orchestrations (org_id, proposal_id);
