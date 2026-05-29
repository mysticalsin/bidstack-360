# Migration Hygiene — BidStack 360° CRM

## Baseline

`20260525010000_sync_drift` is the **baseline migration**. It resolved schema drift
that accumulated during rapid prototyping and must be treated as the canonical
starting point for all future incremental migrations.

**Do not edit `20260525010000_sync_drift/migration.sql` by hand.**

---

## Rules

1. **Incremental only**
   - Every new migration must be a small, reviewable delta.
   - If you need to fix a mistake, create a new migration — never edit an
     already-applied migration file.

2. **No hand-editing existing SQL**
   - The only exception is renaming a migration folder before it is first applied.
   - After a migration has been applied to any shared database (dev, staging,
     prod), its SQL is immutable.

3. **Raw SQL for Prisma gaps**
   - Prisma 5 does not support partial unique indexes (`WHERE deleted_at IS NULL`)
     or `CHECK` constraints natively.
   - When these are needed, add them as raw SQL inside a migration that was
     generated with `--create-only` (or manually created with a proper timestamp).

4. **Timestamp collision prevention**
   - Migration folder names are ordered lexicographically.
   - If two migrations would share the same timestamp prefix, increment the
     latter by at least `100` (e.g. `20260524000000` → `20260524000100`).

5. **Empty migrations**
   - An empty migration folder with a `migration.sql` file (even if 0 bytes) is
     recorded in `_prisma_migrations`.
   - If a migration was never deployed, it is safer to delete the folder and
     create a new one with the correct SQL.
   - If it was already deployed, backfill the missing work in a new migration.

6. **Data migrations**
   - Backfills (e.g. mapping enum values to new table rows) belong in their own
     migration, separate from schema changes.
   - Write them as plain SQL inside a properly timestamped migration folder.

---

## Workflow

```bash
# 1. Edit schema.prisma
# 2. Generate the migration (creates SQL but does not apply)
pnpm db:migrate --create-only

# 3. Review the generated SQL. Add raw SQL for partial indexes / CHECK constraints.
# 4. Apply to local DB
pnpm db:migrate

# 5. Run verification
pnpm db:generate
pnpm db:seed
pnpm typecheck
pnpm test --filter @bidstack/db
```

---

## Current migration history

| Migration | Status | Note |
|-----------|--------|------|
| `20260510231247_init` | Applied | Base tables + enums |
| `20260510235000_add_gin_index` | Applied | Raw GIN trigram index |
| `20260511010000_bidstack_crm_extensions` | Applied | Enrichment, insights, health |
| `20260511020000_add_file_attachments` | Applied | File attachments |
| `20260511030000_add_notes` | Applied | Notes |
| `20260511040000_add_sales_module` | Applied | Sales orders |
| `20260511050000_add_invoicing` | Applied | Invoices |
| `20260513093517_add_workflow_action_org_id_and_audit_log_index` | Applied | Workflow fixes |
| `20260514120646_add_performance_indexes` | Applied | 3 B-tree indexes |
| `20260514124748_add_sync_event_poll_index` | Applied | Sync event poll |
| `20260514174700_add_microsoft_fields` | Applied | Microsoft Entra fields |
| `20260514180000_add_account_tier_and_references` | Applied | Account tier |
| `20260515000909_add_integrations_and_agents` | Applied | Integrations + agents |
| `20260515091047_fix_reference_value_micros_type` | Applied | Reference type fix |
| `20260516010000_canonicalize_opportunity_stage` | Applied | **Empty** — drift fix absorbed into `sync_drift` |
| `20260516020000_bid_office_rfp` | Applied | RFP domain |
| `20260516030000_hermes_sessions` | Applied | Hermes sessions |
| `20260521000000_add_memos_and_bidscore` | Applied | Memos + bid score |
| `20260521010000_add_reference_soft_delete` | Applied | Reference soft delete |
| `20260521020000_add_activities` | Applied | Activities |
| `20260522000000_add_rfp_document_intelligence` | Applied | RFP doc intelligence |
| `20260523000500_add_extraction_heartbeat` | Applied | Extraction heartbeat |
| `20260524000000_add_company_parent_id` | Applied | Company parent FK |
| `20260524000100_add_tenant_export` | Applied | Tenant export table *(renamed from `20260524000000_add_tenant_export`)* |
| `20260525000000_add_roles_and_deleted_at` | Applied | RBAC + soft delete |
| `20260525010000_sync_drift` | Applied | **Baseline** — drift resolution |
| `20260527010000_add_fk_indexes_soft_delete_checks` | Pending | FK indexes, soft-delete cols, partial uniques, CHECK constraints |
| `20260527010100_backfill_pipeline_stages` | Pending | PipelineStage defaults + backfill |
