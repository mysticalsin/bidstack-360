-- Slice 13b: decisions on ranked MSA whitespace flags.
CREATE TABLE "msa_whitespace_decisions" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "contract_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "line" VARCHAR(40) NOT NULL,
    "state" VARCHAR(20) NOT NULL,
    "reason" VARCHAR(500),
    "evidence_hash" VARCHAR(16) NOT NULL,
    "score" INTEGER NOT NULL,
    "decided_by_id" UUID NOT NULL,
    "decided_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cross_sell_action_id" UUID,
    "opportunity_id" UUID,

    CONSTRAINT "msa_whitespace_decisions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "msa_whitespace_decisions_org_msa_line_idx" ON "msa_whitespace_decisions"("org_id", "contract_id", "line", "decided_at");

-- One accepted decision per (MSA, line); backs the row lock in the accept route.
CREATE UNIQUE INDEX "msa_whitespace_decisions_accepted_uq" ON "msa_whitespace_decisions"("org_id", "contract_id", "line") WHERE "state" = 'accepted';

ALTER TABLE "msa_whitespace_decisions" ADD CONSTRAINT "msa_whitespace_decisions_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "msa_whitespace_decisions" ADD CONSTRAINT "msa_whitespace_decisions_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contract_agreements"("id") ON DELETE CASCADE ON UPDATE CASCADE;
