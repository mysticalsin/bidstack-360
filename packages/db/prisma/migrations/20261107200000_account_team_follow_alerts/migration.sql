-- Slice 21: account team and allocation, account follow, account alert
-- coalescing and per-channel notification preferences. Additive only.

-- CreateEnum
CREATE TYPE "account_team_role" AS ENUM ('account_lead', 'delivery_lead', 'pre_sales', 'bid_manager', 'executive_sponsor', 'other');

-- AlterTable
ALTER TABLE "notification_prefs" ADD COLUMN     "account_digest_daily" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "channel_prefs" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "teams_webhook_enc" TEXT,
ADD COLUMN     "teams_webhook_host" TEXT;

-- AlterTable
ALTER TABLE "notifications" ADD COLUMN     "actor_user_id" UUID,
ADD COLUMN     "email_sent_at" TIMESTAMPTZ(6),
ADD COLUMN     "event_count" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "group_key" TEXT,
ADD COLUMN     "last_event_at" TIMESTAMPTZ(6),
ADD COLUMN     "teams_sent_at" TIMESTAMPTZ(6);

-- CreateTable
CREATE TABLE "account_team_members" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "account_team_role" NOT NULL DEFAULT 'other',
    "allocation_pct" INTEGER,
    "start_date" DATE,
    "end_date" DATE,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "account_team_members_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "account_team_members_allocation_pct_check" CHECK ("allocation_pct" IS NULL OR ("allocation_pct" >= 0 AND "allocation_pct" <= 100))
);

-- CreateTable
CREATE TABLE "account_follows" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "muted" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "account_follows_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "account_team_members_org_user_idx" ON "account_team_members"("org_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "account_team_members_company_user_key" ON "account_team_members"("company_id", "user_id");

-- CreateIndex
CREATE INDEX "account_follows_org_user_idx" ON "account_follows"("org_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "account_follows_company_user_key" ON "account_follows"("company_id", "user_id");

-- CreateIndex
CREATE INDEX "notifications_user_group_last_idx" ON "notifications"("user_id", "group_key", "last_event_at" DESC);

-- AddForeignKey
ALTER TABLE "account_team_members" ADD CONSTRAINT "account_team_members_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_team_members" ADD CONSTRAINT "account_team_members_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_team_members" ADD CONSTRAINT "account_team_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_follows" ADD CONSTRAINT "account_follows_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_follows" ADD CONSTRAINT "account_follows_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_follows" ADD CONSTRAINT "account_follows_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
