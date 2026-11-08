-- Slice 26: Teams chat import. A Teams message filed to an account is an
-- activity of type teams_message; a chat linked for ongoing sync is a
-- teams_chat_links row. Additive only.

-- AlterEnum
ALTER TYPE "activity_type" ADD VALUE IF NOT EXISTS 'teams_message';

-- CreateTable
CREATE TABLE "teams_chat_links" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "integration_token_id" UUID NOT NULL,
    "kind" VARCHAR(20) NOT NULL,
    "thread_key" VARCHAR(1000) NOT NULL,
    "chat_id" VARCHAR(300),
    "team_id" VARCHAR(300),
    "channel_id" VARCHAR(300),
    "root_message_id" VARCHAR(300),
    "title" VARCHAR(300) NOT NULL DEFAULT '',
    "web_url" VARCHAR(2000),
    "company_id" UUID NOT NULL,
    "opportunity_id" UUID,
    "keep_syncing" BOOLEAN NOT NULL DEFAULT false,
    "watermark" TIMESTAMPTZ(6),
    "last_synced_at" TIMESTAMPTZ(6),
    "last_error" VARCHAR(64),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "teams_chat_links_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "teams_chat_links_kind_check" CHECK ("kind" IN ('chat', 'channel_thread'))
);

-- CreateIndex
CREATE UNIQUE INDEX "teams_chat_links_org_user_thread_key" ON "teams_chat_links"("org_id", "user_id", "thread_key");

-- CreateIndex
CREATE INDEX "teams_chat_links_org_company_idx" ON "teams_chat_links"("org_id", "company_id");

-- CreateIndex
CREATE INDEX "teams_chat_links_token_sync_idx" ON "teams_chat_links"("integration_token_id", "keep_syncing");

-- AddForeignKey
ALTER TABLE "teams_chat_links" ADD CONSTRAINT "teams_chat_links_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
