-- Money is stored in integer micros (AGENTS.md). investment_themes held filed
-- amounts as a float in currency units, with headcount in the same column.
-- The table is a derived snapshot: every account-intel refresh deletes and
-- recreates an account's rows, and nothing reads it back, so there is no
-- backfill; the next refresh repopulates the new columns.

-- AlterTable
ALTER TABLE "investment_themes" DROP COLUMN "amount",
ADD COLUMN "amount_micros" BIGINT,
ADD COLUMN "headcount" INTEGER;
