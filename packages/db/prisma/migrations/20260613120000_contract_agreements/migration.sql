-- CreateEnum
CREATE TYPE "contract_kind" AS ENUM ('msa', 'framework', 'sow', 'nda', 'other');

-- CreateEnum
CREATE TYPE "contract_rate_schedule" AS ENUM ('annual', 'biannual', 'quarterly', 'adhoc');

-- CreateEnum
CREATE TYPE "contract_status" AS ENUM ('active', 'pending', 'expired', 'terminated');

-- CreateTable
CREATE TABLE "contract_agreements" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "account_key" TEXT NOT NULL,
    "kind" "contract_kind" NOT NULL DEFAULT 'msa',
    "reference" TEXT NOT NULL,
    "countries" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "global_rebate_bps" INTEGER,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'EUR',
    "effective_date" DATE,
    "expiry_date" DATE,
    "rate_review_schedule" "contract_rate_schedule" NOT NULL DEFAULT 'annual',
    "next_rate_review_at" DATE,
    "status" "contract_status" NOT NULL DEFAULT 'active',
    "notes" TEXT,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "contract_agreements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "contract_agreements_org_account_idx" ON "contract_agreements"("org_id", "account_key");

-- CreateIndex
CREATE INDEX "contract_agreements_org_status_idx" ON "contract_agreements"("org_id", "status");

-- CreateIndex
CREATE INDEX "contract_agreements_deleted_at_idx" ON "contract_agreements"("deleted_at");

-- AddForeignKey
ALTER TABLE "contract_agreements" ADD CONSTRAINT "contract_agreements_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

