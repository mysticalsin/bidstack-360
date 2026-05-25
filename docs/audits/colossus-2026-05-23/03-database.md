# Database Audit

## Summary
- **Tables:** 76 models
- **Enums:** 30
- **Migrations:** 19
- **Missing org-scoped tables:** `Permission`, `RolePermission`, `UserRole`
- **Missing indexes:** 6+ confirmed (foreign keys without `@@index`)
- **Unbounded queries found:** 108 `findMany` without explicit `take`/`skip`/`limit` (many use cursor pagination; ~20+ are genuinely unbounded list queries)
- **Nested includes:** 78 occurrences (N+1 risk)
- **Transaction usage:** 41 `prisma.$transaction` calls
- **Org scoping clauses:** 284 `where.*orgId` patterns — generally well-scoped
- **Top risk:** Unbounded `Promise.all` parallel findMany queries in bid-workspace and account-intel routes, combined with missing foreign-key indexes on high-churn junction tables.

---

## Findings

| Severity | Table/File | Issue | Evidence | Fix |
|----------|-----------|-------|----------|-----|
| **Critical** | `apps/api/src/routes/bid-workspace.ts:278-298` | Six parallel unbounded `findMany` queries inside `Promise.all` with no `take`/`skip`/`limit` | `prisma.bidDocument.findMany`, `requirement.findMany`, `complianceMatrixRow.findMany`, `reviewIssue.findMany`, `approvalGate.findMany`, `submissionPackage.findMany` all called without pagination | Add `take` limit (e.g. `take: 500`) or implement cursor pagination |
| **Critical** | `apps/api/src/routes/account-intel.ts:19-28` | Three parallel unbounded `findMany` queries | `accountSolution.findMany`, `accountProduct.findMany`, `documentExtraction.findMany` with only `where: { orgId, accountId, deletedAt: null }` | Add `take` limits or pagination parameters |
| **High** | `ActivityAttendee` | `orgId` field exists but has **no `@@index`** | Model has `@@index([activityId])`, `@@index([contactId])`, `@@index([userId])` but none on `orgId` | Add `@@index([orgId])` |
| **High** | `Note` | `authorUserId` FK has **no `@@index`** | `authorUserId String @map("author_user_id") @db.Uuid` with relation to `User`; indexes only on `[orgId, accountId, createdAt]` and `[orgId, companyId]` | Add `@@index([orgId, authorUserId])` or `@@index([authorUserId])` |
| **High** | `Opportunity` | `territoryId` FK has **no `@@index`** | `territoryId String? @map("territory_id") @db.Uuid` with relation to `Territory`; indexes exist for `orgId+country`, `orgId+stage`, `orgId+ownerId`, `orgId+customer` but not `territoryId` | Add `@@index([orgId, territoryId])` |
| **High** | `Company` | `keyAccountOwnerId` FK has **no `@@index`** | `keyAccountOwnerId String? @map("key_account_owner_id") @db.Uuid` with relation to `User`; indexes only on `[orgId, name]`, `[orgId, domain]` | Add `@@index([orgId, keyAccountOwnerId])` |
| **High** | `DocumentVersion` | `fileAttachmentId` FK has **no `@@index`** | `fileAttachmentId String? @map("file_attachment_id") @db.Uuid` with relation to `FileAttachment`; indexes on `[orgId, bidDocumentId, versionNo]`, `[orgId, bidDocumentId, createdAt]`, `[orgId, ocrStatus, extractionStatus]` | Add `@@index([orgId, fileAttachmentId])` |
| **High** | `RolePermission`, `UserRole` | Junction tables lack **both** `orgId` and soft-delete columns | `RolePermission` has `roleId`, `permissionId` only; `UserRole` has `userId`, `roleId` only. No `deletedAt`, no tenant scoping. | Add `orgId` to junction tables (or enforce via parent relations) and add `deletedAt` if soft-delete needed |
| **Medium** | `Permission` | Global table — **not org-scoped** | `model Permission` has no `orgId`; shared across all tenants (`key` is `@unique`) | Document as intentional global lookup table; if tenant customization is ever needed, migrate to org-scoped reference table |
| **Medium** | Schema-wide | Inconsistent soft-delete patterns | Most tables: `deletedAt DateTime?`. Exceptions: `AuditLog` (no soft delete), `ActivityAttendee` (no soft delete), `ApiKey` uses `revokedAt` instead of `deletedAt`, `IntegrationConfig` uses both `isActive` Boolean AND `deletedAt` | Standardize on `deletedAt` for all tenant tables; add `deletedAt` to `AuditLog` and `ActivityAttendee`; remove redundant `isActive` or document its purpose |
| **Medium** | Schema-wide | 66 `Json` fields with **no DB-level validation** | Examples: `Opportunity.intel`, `Company.address`, `CompanyEnrichment.registryIds`/`address`/`formerNames`/`industryCodes`/`sourceAttribution`/`providerMetadata`, `IntegrationConfig.credentials`, `Workflow.triggerConfig`, `AiInsight.sourceAttribution`, etc. | Add Zod schemas at API boundary; consider PostgreSQL JSON Schema `CHECK` constraints for high-integrity fields |
| **Medium** | `apps/api/src/routes/invoices.ts` | Deep nested `include` without `select` pruning | `include: { lines: true }`, `include: { user: { select: { name: true } } }`, and `include: { lines: { include: { product: { select: { sku: true, name: true } } } } }` | Replace `include: { lines: true }` with `select` on required columns to reduce payload and N+1 impact |
| **Medium** | `apps/api/src/routes/bid-scores.ts:338` | Nested include fetches full parent graph | `include: { opportunity: { include: { company: true } } }` fetches entire `Company` row | Add `select` blocks inside nested includes |
| **Medium** | `apps/api/src/routes/companies.ts:110` | Unqualified `include` block | `include: { ... }` without column selectivity | Limit included fields with `select` |
| **Low** | `packages/db/src/seed.ts:36` | Hardcoded seed org identifier | `SEED_ORG_CLERK = 'org_seed_mantu'` | Move to environment variable or config |
| **Low** | Schema-wide | 30 enums — some may need tenant customization | `OpportunityStage`, `LeadStatus`, `CaseStatus`, `WorkflowTriggerKind`, `WorkflowActionKind` are hardcoded in schema | Document as intentional; if tenant customization needed, migrate to reference tables |
| **Low** | `apps/api/src/routes/audit-logs.ts:41` | `findMany` uses large multiplier for cursor pagination | `take = (accountId ? limit * SCAN_MULTIPLIER : limit) + 1;` where `SCAN_MULTIPLIER` can inflate result set | Cap `take` to a hard maximum (e.g. 1000) regardless of multiplier |

---

## Index Gaps (Foreign Keys Without `@@index`)

The following relation fields do **not** have dedicated `@@index` entries in their models:

| Model | Field | Relation Target |
|-------|-------|-----------------|
| `ActivityAttendee` | `orgId` | `Org` |
| `Note` | `authorUserId` | `User` |
| `Opportunity` | `territoryId` | `Territory` |
| `Company` | `keyAccountOwnerId` | `User` |
| `DocumentVersion` | `fileAttachmentId` | `FileAttachment` |
| `Requirement` | `documentVersionId` | `DocumentVersion` (has `@@index([orgId, bidDocumentId])` but not `documentVersionId`) |
| `ComplianceMatrixRow` | `approverUserId` | `User` |
| `ReviewIssue` | `sourceChunkId` | `SourceChunk` |

> Prisma does **not** auto-create indexes on foreign keys. Every `@relation(fields: [x])` that is queried or joined should have a corresponding `@@index([x])` (preferably composite with `orgId`).

---

## Soft-Delete Coverage Matrix

| Pattern | Tables |
|---------|--------|
| `deletedAt DateTime?` | 68 models (majority) |
| `isActive Boolean` (redundant with `deletedAt`) | `IntegrationConfig` |
| `revokedAt DateTime?` (alternative to `deletedAt`) | `ApiKey` |
| **No soft delete** | `AuditLog`, `ActivityAttendee`, `Permission`, `RolePermission`, `UserRole` |

---

## Query Pattern Observations

- **Org scoping:** Strong. `284` occurrences of `where: { orgId }` or similar across API routes. Tenant isolation is consistently applied.
- **Pagination:** Mixed. Cursor pagination is used in newer routes (`agents.ts`, `audit-logs.ts`), but many list routes still use unbounded `findMany` or simple offset/limit without hard ceilings.
- **Transactions:** 41 `prisma.$transaction` calls — healthy usage for multi-step mutations (contacts, invoices, bid-workspace, dust-integration).
- **N+1 risk:** 78 `include:` occurrences. Most are shallow (`user: { select: { name: true } }`), but several fetch full child arrays (`lines: true`, `company: true`) without limits.

---

## Recommendations (Priority Order)

1. **Add pagination limits** to `bid-workspace.ts`, `account-intel.ts`, and any other unbounded list endpoints.
2. **Add missing `@@index` directives** for all foreign keys listed above; run `pnpm db:migrate`.
3. **Standardize soft-delete:** Add `deletedAt` to `AuditLog` and `ActivityAttendee`; reconcile `IntegrationConfig.isActive` vs `deletedAt`.
4. **Add Zod validation** for all `Json` input fields at the Fastify route level (especially `credentials`, `intel`, `config`).
5. **Prune nested includes:** Replace `include: { relation: true }` with `include: { relation: { select: { id: true, name: true } } }` across routes.
6. **Document `Permission` as global:** If intentional, add a comment in schema. If not, make it org-scoped.
