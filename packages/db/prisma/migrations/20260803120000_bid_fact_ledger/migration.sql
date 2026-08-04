-- Round 2 Phase 0: the BidFact ledger.
-- Everything the compliance agent proposes lands here first. Nothing it
-- produces reaches compliance_matrix_rows.answer_draft without a human
-- decision, and every accepted claim keeps its citations and its verdict.
--
-- IMMUTABLE BY DISCIPLINE: bid_facts rows are written once. A revised claim
-- is a NEW row; the old row is marked SUPERSEDED and superseded_by_id points
-- forward. Hence no updated_at and no deleted_at on any of these tables — an
-- audit ledger you can soft-delete is not an audit ledger.
--
-- Additive-only: no existing table, column, index or constraint is touched.

-- CreateEnum
CREATE TYPE "bid_fact_status" AS ENUM ('PROPOSED', 'APPLIED', 'DISMISSED', 'SUPERSEDED');

-- CreateTable
-- assessment_status is Round 1's enum reused verbatim (unknown != bad):
-- UNAVAILABLE when the requirement has no source chunk to assess, which must
-- never render as a 0 score. confidence_bps is nullable for the same reason —
-- NULL means no score exists; 0 is a real score, not a sentinel.
-- value_hash is a normalized SHA-256 of the claim (lowercase, whitespace
-- collapsed, punctuation stripped) computed in code, so a value a human has
-- already dismissed is never re-offered.
CREATE TABLE "bid_facts" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "opportunity_id" UUID,
    "subject_type" VARCHAR(40) NOT NULL,
    "subject_id" UUID NOT NULL,
    "claim" TEXT NOT NULL,
    "verdict" VARCHAR(30) NOT NULL,
    "confidence_bps" INTEGER,
    "band" VARCHAR(12),
    "assessment_status" "assessment_status" NOT NULL DEFAULT 'PENDING',
    "rationale" TEXT,
    "status" "bid_fact_status" NOT NULL DEFAULT 'PROPOSED',
    "value_hash" VARCHAR(64) NOT NULL,
    "produced_by_agent_key" VARCHAR(80) NOT NULL,
    "dust_run_id" UUID,
    "superseded_by_id" UUID,
    "decided_by_user_id" UUID,
    "decided_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bid_facts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
-- Typed replacement for the untyped compliance_matrix_rows.citations JSON.
-- source_chunk_id is NOT NULL and a real FK, unlike the nullable
-- requirements.source_chunk_id: a requirement with no chunk is UNAVAILABLE
-- evidence, but a citation with no chunk is an invented citation.
CREATE TABLE "bid_fact_citations" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "bid_fact_id" UUID NOT NULL,
    "source_chunk_id" UUID NOT NULL,
    "page_start" INTEGER,
    "page_end" INTEGER,
    "quote" TEXT NOT NULL,

    CONSTRAINT "bid_fact_citations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
-- Calibration flywheel: one row per human accept/dismiss. evidence_kinds is a
-- deliberate denormalized snapshot of what the agent observed at decision
-- time — the evidence weights are explicit starting guesses and this is the
-- only record that can ever re-price them.
CREATE TABLE "bid_fact_decisions" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "bid_fact_id" UUID NOT NULL,
    "decision" VARCHAR(10) NOT NULL,
    "decided_by_user_id" UUID NOT NULL,
    "evidence_kinds" TEXT[],
    "score_bps" INTEGER,
    "band" VARCHAR(12),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bid_fact_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- Every index is org-pinned first: org_id leads every tenant-scoped read.
CREATE INDEX "bid_facts_org_id_subject_type_subject_id_status_idx" ON "bid_facts"("org_id", "subject_type", "subject_id", "status");

-- CreateIndex
CREATE INDEX "bid_facts_org_id_opportunity_id_created_at_idx" ON "bid_facts"("org_id", "opportunity_id", "created_at");

-- CreateIndex
CREATE INDEX "bid_fact_citations_bid_fact_id_idx" ON "bid_fact_citations"("bid_fact_id");

-- CreateIndex
CREATE INDEX "bid_fact_citations_source_chunk_id_idx" ON "bid_fact_citations"("source_chunk_id");

-- CreateIndex
CREATE INDEX "bid_fact_decisions_org_id_created_at_idx" ON "bid_fact_decisions"("org_id", "created_at");

-- CreateIndex
CREATE INDEX "bid_fact_decisions_bid_fact_id_idx" ON "bid_fact_decisions"("bid_fact_id");

-- AddForeignKey
ALTER TABLE "bid_facts" ADD CONSTRAINT "bid_facts_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bid_facts" ADD CONSTRAINT "bid_facts_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "opportunities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bid_fact_citations" ADD CONSTRAINT "bid_fact_citations_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bid_fact_citations" ADD CONSTRAINT "bid_fact_citations_bid_fact_id_fkey" FOREIGN KEY ("bid_fact_id") REFERENCES "bid_facts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
-- Cascade, not restrict: a citation is a pointer into chunk text that must be
-- re-verifiable. Once the chunk is gone the quote can no longer be re-found,
-- and an unverifiable citation must not survive as if it were evidence. The
-- bid_facts row remains and then reads as evidence UNAVAILABLE, never
-- invented. Restrict would also deadlock document re-parse and org deletion,
-- both of which hard-delete source_chunks.
ALTER TABLE "bid_fact_citations" ADD CONSTRAINT "bid_fact_citations_source_chunk_id_fkey" FOREIGN KEY ("source_chunk_id") REFERENCES "source_chunks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bid_fact_decisions" ADD CONSTRAINT "bid_fact_decisions_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bid_fact_decisions" ADD CONSTRAINT "bid_fact_decisions_bid_fact_id_fkey" FOREIGN KEY ("bid_fact_id") REFERENCES "bid_facts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
