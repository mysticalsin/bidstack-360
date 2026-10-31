-- MSA library (2026-10-31).
--
-- Reuses contract_agreements as the MSA record (kind msa, plus sow,
-- amendment and addendum children via parent_id) and file_attachments for the
-- stored bytes. Adds:
--   * MSA fields on contract_agreements (company link, parent link, title,
--     counterparty, auto-renew + notice period, governing law, liability cap,
--     payment terms, owner, tags) and the draft / in_negotiation statuses.
--   * contract_file_versions: versioned files with a server-computed SHA-256
--     and extracted text, plus a Postgres FTS GIN index over that text.
--   * A partial unique index that dedupes MSA reminder notifications.
--   * msa:read / msa:write / msa:admin, granted so nobody loses access to the
--     contract data they can already see through accounts:read/write.
-- Incremental only. Idempotent data inserts (ON CONFLICT DO NOTHING) so a
-- grant an org admin has revoked is never revived.

ALTER TYPE "contract_kind" ADD VALUE 'amendment';
ALTER TYPE "contract_kind" ADD VALUE 'addendum';

ALTER TYPE "contract_status" ADD VALUE 'draft';
ALTER TYPE "contract_status" ADD VALUE 'in_negotiation';

-- AlterTable
ALTER TABLE "contract_agreements" ADD COLUMN     "auto_renew" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "company_id" UUID,
ADD COLUMN     "counterparty" VARCHAR(300),
ADD COLUMN     "governing_law" VARCHAR(200),
ADD COLUMN     "liability_cap_currency" VARCHAR(3),
ADD COLUMN     "liability_cap_micros" BIGINT,
ADD COLUMN     "notice_period_days" INTEGER,
ADD COLUMN     "owner_id" UUID,
ADD COLUMN     "parent_id" UUID,
ADD COLUMN     "payment_terms" VARCHAR(500),
ADD COLUMN     "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "title" VARCHAR(300);

-- CreateTable
CREATE TABLE "contract_file_versions" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "contract_id" UUID NOT NULL,
    "version_no" INTEGER NOT NULL,
    "file_attachment_id" UUID NOT NULL,
    "file_name" VARCHAR(255) NOT NULL,
    "content_type" VARCHAR(100) NOT NULL,
    "bytes" INTEGER NOT NULL,
    "sha256" VARCHAR(64) NOT NULL,
    "note" VARCHAR(1000),
    "extraction_status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "extraction_error" VARCHAR(500),
    "extracted_text" TEXT,
    "extracted_at" TIMESTAMPTZ(6),
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

CONSTRAINT "contract_file_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "contract_file_versions_org_contract_idx" ON "contract_file_versions"("org_id", "contract_id");

-- CreateIndex
CREATE INDEX "contract_file_versions_org_sha_idx" ON "contract_file_versions"("org_id", "sha256");

-- CreateIndex
CREATE INDEX "contract_file_versions_deleted_at_idx" ON "contract_file_versions"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "contract_file_versions_contract_version_uq" ON "contract_file_versions"("contract_id", "version_no");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "contract_agreements_org_company_idx" ON "contract_agreements"("org_id", "company_id");

-- CreateIndex
CREATE INDEX "contract_agreements_org_parent_idx" ON "contract_agreements"("org_id", "parent_id");

-- CreateIndex
CREATE INDEX "contract_agreements_org_expiry_idx" ON "contract_agreements"("org_id", "expiry_date");

-- AddForeignKey
-- company_id, its index and FK may already exist from
-- 20261031170000_close_dates_and_account_links on the consolidated branch.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contract_agreements_company_id_fkey') THEN
    ALTER TABLE "contract_agreements" ADD CONSTRAINT "contract_agreements_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
ALTER TABLE "contract_agreements" ADD CONSTRAINT "contract_agreements_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "contract_agreements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_agreements" ADD CONSTRAINT "contract_agreements_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_file_versions" ADD CONSTRAINT "contract_file_versions_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_file_versions" ADD CONSTRAINT "contract_file_versions_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contract_agreements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_file_versions" ADD CONSTRAINT "contract_file_versions_file_attachment_id_fkey" FOREIGN KEY ("file_attachment_id") REFERENCES "file_attachments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_file_versions" ADD CONSTRAINT "contract_file_versions_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Full-text search over extracted text. 'simple' config: contracts are
-- multi-language (EN/FR/DE), so no language-specific stemming. Partial on live
-- rows. Prisma cannot express expression indexes, so this stays raw SQL.
CREATE INDEX IF NOT EXISTS "contract_file_versions_fts_idx"
  ON "contract_file_versions"
  USING GIN (to_tsvector('simple', coalesce("extracted_text", '')))
  WHERE "deleted_at" IS NULL;

-- At most one MSA reminder per (org, user, reminder url). Scoped to the MSA
-- reminder deep links (`/msa/:id?reminder=:kind`) so it never blocks other
-- notifications. Backs apps/worker/src/queues/msa-reminders.ts.
CREATE UNIQUE INDEX IF NOT EXISTS "notifications_msa_reminder_dedupe_uq"
  ON "notifications" ("org_id", "user_id", "url")
  WHERE "url" LIKE '/msa/%?reminder=%';

-- Permissions (global keys).
INSERT INTO "permissions" ("id", "key", "name", "description") VALUES
  (gen_random_uuid(), 'msa:read', 'Read MSAs', 'View the MSA library: agreements, SOWs, amendments, file versions, timeline and search.'),
  (gen_random_uuid(), 'msa:write', 'Manage MSAs', 'Create and update MSAs and child agreements, and upload new file versions.'),
  (gen_random_uuid(), 'msa:admin', 'Administer MSAs', 'Archive MSAs and file versions, and edit any MSA regardless of owner.')
ON CONFLICT ("key") DO NOTHING;

-- Nobody loses access: the legacy /contract-agreements routes now also need
-- msa:read / msa:write, so every role holding accounts:read / accounts:write
-- today receives the matching msa key.
INSERT INTO "role_permissions" ("role_id", "permission_id", "org_id")
SELECT rp."role_id", m."id", rp."org_id"
FROM "role_permissions" rp
JOIN "permissions" a ON a."id" = rp."permission_id"
JOIN "permissions" m ON (a."key" = 'accounts:read' AND m."key" = 'msa:read')
                     OR (a."key" = 'accounts:write' AND m."key" = 'msa:write')
WHERE rp."deleted_at" IS NULL
ON CONFLICT ("role_id", "permission_id") DO NOTHING;

-- msa:admin: system Admin role only.
INSERT INTO "role_permissions" ("role_id", "permission_id", "org_id")
SELECT r."id", p."id", r."org_id"
FROM "roles" r
JOIN "permissions" p ON p."key" IN ('msa:read', 'msa:write', 'msa:admin')
WHERE r."is_system" = true
  AND r."name" = 'Admin'
  AND r."deleted_at" IS NULL
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
