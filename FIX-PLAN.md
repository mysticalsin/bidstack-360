# FIX-PLAN — BidStack 360°

> **Date:** 2026-05-15
> **Branch:** `feat/sprint-0-foundation` at HEAD `fc95727` + 3 uncommitted plugin edits
> **Method:** five parallel specialist audits (regression, multi-tenancy, new-feature security, type/log hygiene, performance + idempotency) — verified manually for high-impact items
> **Prior audits cross-referenced:** [AUDIT-2026-05-11.md](AUDIT-2026-05-11.md), [AUDIT_SECURITY_2026-05-11.md](AUDIT_SECURITY_2026-05-11.md), [MISTAKES.md](MISTAKES.md)
> **Verdict:** the 88/100 from Sprint A has slipped. New feature surfaces (RBAC, Invoices, Reports, Bulk Actions) shipped without role gates; TOCTOU multi-tenancy gaps appeared in several refactors. **No production deploy until BLOCKER bucket is green.**

Each item has a checkbox so you can track progress. Cite the item ID (`BS-1` etc.) in commit messages.

---

## 0 · How to use this plan

1. **BLOCKERS first** — these are exploitable today.
2. **One commit per BLOCKER ID** so reverts are surgical.
3. **MAJORs in the same sprint** but can be batched (e.g., all "missing role gate" in one commit).
4. **MINORs** ship when adjacent code is being touched anyway — don't open a separate PR for them.
5. **Cross-cutting refactors** (file-size, service extraction) get their own design doc — see `BS-R1` below.
6. When you fix an item: tick the box, add a one-line note under it, and reference the commit SHA.
7. When you discover a new issue: append to BS-N1+ at the bottom rather than renumbering.

---

## 1 · BLOCKERS — fix before any deploy

### Authorization gaps (privilege escalation)

The RBAC, Invoicing, Tasks, Companies, and Reports surfaces all ship without role gates. Any authenticated org member can perform admin/finance-only operations. The `requireRole` middleware **already exists** (`apps/api/src/plugins/rbac.ts`, used in 6 other routes) — these routes simply didn't import it.

- [x] **BS-1 [BLOCKER] RBAC routes leak the permission model** — `apps/api/src/routes/roles.ts` `GET /roles` and `GET /permissions` have no role gate. Any member can enumerate every role and the full permission catalogue.
      **Fix:** add `preHandler: server.requireRole('admin')` to both GET handlers. Wire `requireRole` to the route options as the other admin-only routes do.
      ✅ Fixed — `requireRole('admin')` added to GET /roles and GET /permissions. Verified in roles.ts lines 20-40.

- [x] **BS-2 [BLOCKER] Role mutations are unguarded** — `apps/api/src/routes/roles.ts:70-191` `POST /roles`, `PATCH /roles/:id`, `DELETE /roles/:id` allow any member to create, modify, or soft-delete roles. Privilege escalation.
      **Fix:** add `preHandler: server.requireRole('admin')` to all three handlers.
      ✅ Fixed — `requirePermission('settings:write')` + `requireRole('admin')` on all three mutating handlers. Verified in roles.ts.

- [x] **BS-3 [BLOCKER] Invoice mutations are unguarded** — [apps/api/src/routes/invoices.ts:163,243,469,515,580,662](apps/api/src/routes/invoices.ts) — invoice create, update, state transition, payments, AR aging are open to any member.
      **Fix:** apply `preHandler: server.requireRole('admin', 'finance')` to every mutating handler. For the CSV export at line 695, apply the same gate.
      ✅ Fixed — `requirePermission('invoices:write')` + `requireRole('admin')` on all mutating invoice handlers. Verified in invoices.ts.

- [x] **BS-4 [BLOCKER] Task mutations are unguarded** — [apps/api/src/routes/tasks.ts:74,121,188](apps/api/src/routes/tasks.ts) — create / patch / delete have no `requireRole` and no project-scoped check.
      **Fix:** gate per the decision; if cross-member task writes are wanted, add an "assigned-to-me or admin" check at the handler.
      ✅ Fixed — `requirePermission('tasks:write')` added to POST (commit `0b53f26b`), PATCH, and DELETE. In-handler admin/assignee/unassigned ownership check preserved for PATCH/DELETE. Verified 2026-05-28.

- [x] **BS-5 [BLOCKER] Company mutations are unguarded** — [apps/api/src/routes/companies.ts:160,194,232](apps/api/src/routes/companies.ts) — `POST`, `PATCH`, `DELETE` open to any member.
      **Fix:** add `requireRole('admin')` (or `requireRole('admin', 'manager')` if managers should be allowed to edit accounts).
      ✅ Fixed — `requirePermission('companies:write')` + `requireRole('admin')` on mutating company handlers. Verified in companies.ts and crm/companies.ts.

- [x] **BS-6 [BLOCKER] Apollo enrichment quota burnable by any user** — [apps/api/src/routes/crm/companies.ts:171-206](apps/api/src/routes/crm/companies.ts) — `POST /crm/companies/:id/enrich` and `POST /crm/companies/autopopulate-from-sales` trigger paid external Apollo calls with no role gate.
      **Fix:** `requireRole('admin')` + a per-user rate limit (e.g., 10/hour) at the route level.
      ✅ Fixed — `requirePermission('companies:write')` + `requireRole('admin')` + `rateLimit: { max: 10, timeWindow: '1 hour' }` on both endpoints. Verified in crm/companies.ts lines 170-229.

### Multi-tenancy — missing orgId in mutating `where` clauses (TOCTOU)

The pattern in every case below is: `findFirst({ where: { id, orgId } })` ownership check, then `update({ where: { id } })` — the update is unscoped, so a stale or attacker-supplied `id` from another org will succeed. Code-quality rule 7 ([.claude/rules/code-quality.md](.claude/rules/code-quality.md)) says: _"Every Prisma query that touches a tenant table MUST include `where: { orgId }`."_ The fix is mechanical: also include `orgId: req.auth.orgId` in the update's `where`.

- [x] **BS-7 [BLOCKER] `Role` update/delete unscoped** — [apps/api/src/routes/roles.ts:149-157](apps/api/src/routes/roles.ts), [apps/api/src/routes/roles.ts:185-188](apps/api/src/routes/roles.ts).
      ✅ Fixed — `updateMany({ where: { id, orgId } })` and `updateMany({ where: { id, orgId } })` for soft-delete. Verified in roles.ts.

- [x] **BS-8 [BLOCKER] `Reference` update/delete/use unscoped** — `apps/api/src/routes/references.ts:141`, `:175`, `:196`. `delete` may need to switch to `deleteMany` with `{ id, orgId }` since Prisma's `delete` requires a unique field.
      ✅ Fixed — TOCTOU pattern applied to references.ts. All mutations use `updateMany` / `deleteMany` with `{ id, orgId }`.

- [x] **BS-9 [BLOCKER] `Opportunity` update inside dust-integration unscoped** — `apps/api/src/routes/dust-integration.ts:139`. Inside a `$transaction`, the opp was fetched org-scoped at :108 but the update is on `{ id }` only.
      ✅ Fixed — `updateMany({ where: { id: opp.id, orgId } })` inside the transaction. Verified in dust-integration.ts.

- [x] **BS-10 [BLOCKER] `User` update unscoped** — `apps/api/src/routes/users.ts:54`.
      ✅ Fixed — `updateMany({ where: { id, orgId } })`. Verified in users.ts.

- [x] **BS-11 [BLOCKER] `ServiceCase` update unscoped** — `apps/api/src/routes/service-desk.ts:157`.
      ✅ Fixed — `updateMany({ where: { id, orgId } })`. Verified in service-desk.ts.

- [x] **BS-12 [BLOCKER] Soft-delete updates unscoped on Note / Lead / Plugin / Workflow** — `apps/api/src/routes/notes.ts:393`, `leads.ts:384`, `plugins.ts:112`, `workflows.ts:129`.
      ✅ Fixed — `updateMany({ where: { id, orgId, deletedAt: null } })` in all four files.

- [x] **BS-13 [BLOCKER] Worker `DocumentExtraction` updates unscoped** — `apps/worker/src/queues/document-extract.ts:247,371,403`. Thread `orgId` from the job payload into the `where` clause.
      ✅ Fixed — `orgId` threaded from job payload into all three update `where` clauses. Verified in document-extract.ts.

- [x] **BS-14 [BLOCKER] Worker `SyncEvent` updates unscoped** — `apps/worker/src/queues/webhook-processor.ts:119,126`. Use `where: { id: evt.id, orgId: evt.orgId }`.
      ✅ Fixed — `{ id: evt.id, orgId: evt.orgId }` on both updates. Verified in webhook-processor.ts.

- [x] **BS-15 [BLOCKER] Workflow action `assigneeId` not org-validated** — `apps/api/src/routes/workflows.ts:300` — `task.create` reads `config.assigneeId` from workflow config JSON without verifying the user belongs to the same org.
      **Fix:** `prisma.user.findFirst({ where: { id: config.assigneeId, orgId } })` before the create; reject if missing.
      ✅ Fixed — org-scoped user lookup before task.create in workflow action handler. Verified in workflows.ts.

---

## 2 · MAJOR — fix this sprint

### Header & content-injection

- [x] **BS-16 [MAJOR] Content-Disposition injection in invoice export** — [apps/api/src/routes/invoices.ts:749](apps/api/src/routes/invoices.ts) — the CSV filename interpolates the user-supplied `state` query param without sanitisation.
      **Fix:** allowlist the `state` value to the invoice-state enum before using it in the filename; mirror RFC 5987 encoding pattern already used in `apps/api/src/routes/files.ts:50-60`.
      ✅ Fixed — state param allowlisted to invoice-state enum; RFC 5987 filename encoding applied. Verified in invoices.ts.

- [x] **BS-17 [MAJOR] Uncommitted plugin edits replace `httpErrors` with raw `Error`** — `apps/api/src/plugins/api-versioning.ts` and `apps/api/src/plugins/idempotency.ts` swap `req.server.httpErrors.badRequest(...)` for `new Error(...)` + manual `statusCode`.
      **Fix:** revert to `req.server.httpErrors.badRequest(...)` / `notFound(...)`.
      ✅ Fixed — `req.server.httpErrors.badRequest(...)` restored in api-versioning.ts and idempotency.ts. Verified: api-versioning.ts line 41.

### Auth identity drift

- [x] **BS-18 [MAJOR] `auth.ts` stamps Microsoft fields on every Clerk login** — uncommitted edit sets `microsoftEmail` and `microsoftConnectedAt` to the Clerk email and `new Date()` on every request.
      **Fix:** remove the Microsoft fields from the upsert.
      ✅ Fixed — Microsoft fields removed from generic auth upsert. Verified in auth.ts.

- [x] **BS-19 [MAJOR] Clerk role mapping silently downgrades unknown roles to `member`** — `mapClerkRole` falls through to `'member'` for any unrecognised string.
      **Fix:** log a warning and throw / 403 on unknown roles. Treat the mapping as a closed allowlist.
      ✅ Fixed — unknown roles now logged with Pino warning and rejected with 403. Verified in auth.ts.

### Idempotency

- [x] **BS-20 [MAJOR] Idempotency `public` scope collides across unauthenticated callers** — `apps/api/src/plugins/idempotency.ts:75` falls back to the literal string `'public'` when `req.auth?.userId` is unset.
      **Fix:** use `req.auth.userId` and throw 401 if absent.
      ✅ Fixed — falls back to 401 instead of `'public'` string. Verified in idempotency.ts.

- [x] **BS-21 [MAJOR] In-memory idempotency fallback is unbounded** — `apps/api/src/plugins/idempotency.ts:27` — when Redis is unavailable, the module-level `Map` grows unboundedly.
      **Fix:** cap the Map at e.g. 5,000 entries (LRU) and add a `setInterval` cleanup.
      ✅ Fixed — LRU cap + `setInterval` cleanup added to idempotency fallback. Verified in idempotency.ts.

### Performance — unbounded findMany

- [x] **BS-22 [MAJOR] Unbounded `findMany` in reports** — `apps/api/src/routes/reports.ts:48-51` (`contact.findMany`), `:88-96` (`companyEnrichment.findMany`). No `take`.
      **Fix:** `take: 500` (contacts), `take: 200` (enrichment).
      ✅ Fixed — `take: 500` and `take: 200` applied. Verified in reports.ts.

- [x] **BS-23 [MAJOR] Unbounded `findMany` in dashboard health probes** — `apps/api/src/services/crm/dashboard.service.ts:279-301`.
      **Fix:** `take: 50` on both.
      ✅ Fixed — `take: 50` on providerHealth and queueHealth findMany. Verified in dashboard.service.ts.

- [x] **BS-24 [MAJOR] Invoice CSV export loads 1,000 rows in memory** — `apps/api/src/routes/invoices.ts:673-699`.
      **Fix:** cursor-paginate and stream rows to the response.
      ✅ Fixed — cursor-paginated streaming export. Commit `0b53f26b`.

- [x] **BS-25 [MAJOR] Opportunity list over-fetches full `User` row** — `apps/api/src/routes/opportunities.ts:52` `include: { owner: true }`.
      **Fix:** `owner: { select: { id: true, name: true, email: true } }`.
      ✅ Fixed — narrowed to `{ select: { id: true, name: true, email: true } }`. Commit `0b53f26b`.

### Carry-over from AUDIT-2026-05-11.md (still open)

- [x] **BS-26 [MAJOR] S-M2 — single global rate-limit** — `apps/api/src/server.ts:184-194`. Webhooks and `/api/integrations/api-keys` share the same 600/min envelope. Add per-route limits.
      ✅ Fixed — per-route limits applied: webhooks `max: 100/min`, api-keys `max: 30/min`, sensitive mutation routes individually capped. Verified in webhooks.ts, api-keys.ts, and crm/companies.ts.

- [x] **BS-27 [MAJOR] S-M7 — raw-body parser is server-scoped** — `apps/api/src/routes/webhooks.ts:52-60`. Move the `addContentTypeParser` into an encapsulated `register(..., { prefix: '/webhooks' })`.
      ✅ Fixed — `addContentTypeParser` lives inside `webhooksRoutes` plugin function (Fastify encapsulation ensures it is scoped to that plugin only). Verified in webhooks.ts lines 100-111.

- [x] **BS-28 [MAJOR] A-S1 — TasksPage filter chips use wrong ARIA pattern** — `apps/web/src/pages/TasksPage.tsx:202,608` — `role=tablist` / `role=tab` without `tabpanel`.
      **Fix:** Swap to `<button aria-pressed={active}>` toggle pattern.
      ✅ Fixed — `aria-pressed` toggle pattern applied to TasksPage and SalesOrdersPage filter chips.

- [x] **BS-29 [MAJOR] A-S3 — `aria-grabbed` on PipelinePage** — `apps/web/src/pages/PipelinePage.tsx:446`. Replace with visible drag instructions; split Link/drag semantics.
      ✅ Fixed — `aria-grabbed` removed; drag handle uses `role="button"` with keyboard instructions. Verified in PipelinePage.tsx.

- [x] **BS-30 [MAJOR] A-S4 — color-only signal on overdue tasks** — `apps/web/src/pages/TasksPage.tsx:536-537`. Prefix with `⚠` icon or "Overdue:" text.
      ✅ Fixed — "⚠ Overdue" text prefix added alongside color coding. Verified in TasksPage.tsx.

- [x] **BS-31 [MAJOR] A-B2 — Dialog close button below 44px** — `apps/web/src/components/ui/Dialog.tsx:34` — currently `h-9 w-9` (36×36).
      **Fix:** Use `h-11 w-11` on `pointer-coarse:` or wrap in a 44×44 hit area.
      ✅ Fixed — `pointer-coarse:min-h-[44px] pointer-coarse:min-w-[44px]` applied to Dialog close button. Verified in Dialog.tsx.

- [x] **BS-32 [MAJOR] A-B3 — Nested live regions in Toast** — `apps/web/src/components/ui/Toast.tsx:104-107` — wrapper has `role=region aria-live=polite` and each card adds `role=alert`.
      **Fix:** Remove `aria-live` from the wrapper.
      ✅ Fixed — `aria-live` removed from Toast wrapper; only individual `role=alert` cards announce. Verified in Toast.tsx.

---

## 3 · MINOR — fold in when nearby

- [x] **BS-33 [MINOR] Cross-org permission UUIDs accepted by role PATCH** — `apps/api/src/routes/roles.ts:97-98` connects any `permissionId` without verifying it exists.
      ✅ Fixed — `permission.findMany({ where: { id: { in: permissionIds } } })` validation added before `rolePermission.createMany`; unknown IDs return 400 with the bad UUID(s) listed. Verified 2026-05-28.

- [x] **BS-34 [MINOR] API-versioning 404 vs 400** — `apps/api/src/plugins/api-versioning.ts:42` returns 404 on unsupported version. 400 is more conventional and leaks less routing structure.
      ✅ Fixed — `httpErrors.badRequest(...)` used for unsupported API version. Verified in api-versioning.ts line 41.

- [x] **BS-35 [MINOR] `window.confirm` on invoice cancel** — `apps/web/src/pages/InvoiceDetailPage.tsx:115`. Replace with the shared `confirm()` utility used in `RolesSection.tsx`.
      ✅ Fixed — `window.confirm` replaced with shared ConfirmDialog/imperative confirm(). Commit `91de6dd1`.

- [x] **BS-36 [MINOR] Worker N+1 on opportunity create/update** — `apps/api/src/routes/opportunities.ts:127,140,258,290,425,441` — sequential `user.findFirst` + `territory.findFirst` per mutation.
      **Fix:** Wrap in `Promise.all`.
      ✅ Fixed — `Promise.all([user.findFirst(...), territory.findFirst(...)])` applied. Commit `edc2d26a`.

- [x] **BS-37 [MINOR] Notes list over-fetches author** — `apps/api/src/routes/notes.ts:162` `include: { author: true }` — narrow to a select.
      ✅ Fixed — narrowed to `author: { select: { email: true } }`. Commit `b22f1ebc`.

- [x] **BS-38 [MINOR] Audit-log user over-fetch** — `apps/api/src/routes/audit-logs.ts:43` — narrow to `user: { select: { name: true, email: true } }`.
      ✅ Fixed — narrowed to `user: { select: { name: true, email: true } }`. Commit `b22f1ebc`.

- [x] **BS-39 [MINOR] Presence join split** — `apps/api/src/routes/collaboration.ts:197,209` — two-step join can be a single query with `include: { user: { select: { ... } } }`.
      ✅ Fixed — single `userPresence.findMany({ include: { user: { select: { name: true } } } })` replaces the two-query pattern. Verified 2026-05-28.

- [x] **BS-40 [MINOR] ReportsPage tab buttons miss 44px + ARIA semantics** — `apps/web/src/pages/ReportsPage.tsx` tab strip — `px-3 py-1 text-xs` renders below 44px.
      ✅ Fixed — `aria-pressed` toggle pattern + `pointer-coarse:min-h-[44px] pointer-coarse:min-w-[44px]` applied. Commit `91de6dd1`.

- [x] **BS-41 [MINOR] `opportunityValueEur` → `opportunityValueMicros` is a silent breaking rename** — `packages/shared/src/schemas/leads.ts`, `apps/api/src/routes/leads.ts`, `apps/mcp-server/src/tools/leads-convert.ts`.
      ✅ Fixed — `opportunityValueMicros` is the canonical field name across all three files. No legacy `Eur` variant present. Verified in shared/leads.ts line 125.

- [x] **BS-42 [MINOR] Territories sort drops BigInt precision** — `apps/api/src/routes/territories.ts:490,501` — `Number(c.totalValueMicros)` before sort.
      ✅ Fixed — sort performed on BigInt values; `Number()` conversion only at serialization. Commit `b22f1ebc`.

- [x] **BS-43 [MINOR] `companies/search` and `/lookup` use heavy `buildDashboardSnapshot`** — `apps/api/src/routes/crm/companies.ts` calls the snapshot builder for lean lookups.
      ✅ Fixed — `getCompaniesOnly(orgId, prisma)` used for search/lookup endpoints; `buildCompanyCockpit` only for the single-company cockpit GET. Commit `edc2d26a`.

---

## 4 · Refactor — design doc required

- [ ] **BS-R1 13 source files exceed the 400-line cap** (`.claude/rules/code-quality.md`):
  - `apps/api/src/services/crm/dashboard.service.ts` — 1,477 (3.7× cap)
  - `apps/web/src/components/dashboard/OrgDashboard.tsx` — 1,009
  - `apps/api/src/routes/notes.ts` — 933
  - `apps/web/src/pages/OpportunitiesPage.tsx` — 877
  - `apps/api/src/services/reports/sales-intelligence.service.ts` — 783
  - `apps/api/src/routes/invoices.ts` — 768
  - `apps/api/src/routes/odoo-integration.ts` — 742
  - `apps/web/src/pages/ContactsPage.tsx` — 730
  - `apps/api/src/routes/territories.ts` — 713
  - `apps/web/src/pages/TasksPage.tsx` — 663
  - `apps/web/src/App.tsx` — 651
  - `apps/web/src/pages/IntakePage.tsx` — 604
  - `apps/api/src/routes/opportunities.ts` — 524

  **Fix:** open `docs/refactor/file-size-debt.md` listing the split plan per file. Don't ship the splits in one PR — each file gets its own commit. Highest leverage: split `dashboard.service.ts` into per-widget query modules.

---

## 5 · Updates to AUDIT-2026-05-11.md (housekeeping)

These items were marked OPEN in the prior audit but verified-fixed in current HEAD. Update the document so future audits don't re-flag them:

- [x] **S-M4** (files.ts finalize storageKey verification) — fixed at `apps/api/src/routes/files.ts:155-160`.
- [x] **S-M5** (Content-Disposition RFC 5987 encoding) — fixed at `apps/api/src/routes/files.ts:50-60,239`.
- [x] **S-M6** (local-upload key-prefix check) — fixed at `apps/api/src/routes/files.ts:135-142`.
- [x] **S-M8** (api-key audit logging) — fixed at `apps/api/src/routes/dust-integration.ts:310-314,353-357`.
- [x] **S-M9** (SSRF guard for webhook URLs) — fixed via `apps/api/src/lib/ssrf-guard.ts` + `webhook-subscriptions.ts:61`.
- [x] **S-B3** (Apollo worker payload trust) — `verifyApolloEnrichJobSignature` is in place at `apps/worker/src/queues/company-enrich-apollo.ts:233` with tests in `company-enrich-apollo.test.ts:101-137`. CLOSED.

---

## 6 · False positives caught during this audit

Logged here so future passes don't re-flag them:

- **`prisma.permission.findMany` missing `orgId`** — `Permission` is a global catalogue (no `orgId` column in `packages/db/prisma/schema.prisma:1373-1381`). Rule 7 only applies to tenant tables.
- **`BulkActionBar` `size="sm"` < 44px** — the Button component applies `pointer-coarse:min-h-11 pointer-coarse:min-w-11`, so touch devices get 44×44 automatically.
- **`bulk.clear()` before reading `selectedItems.length`** — `selectedItems` is captured in the render closure (`useMemo` result); React doesn't recompute it mid-handler, so the count is preserved across the `clear()` call.
- **GET /permissions "auth bypass via async() with no `req`"** — Fastify preHandlers run regardless of handler arity. The missing `orgId` filter is moot (see Permission catalogue note above), but the missing `requireRole` gate is a real BLOCKER (see BS-1).

---

## 7 · Suggested commit boundaries

1. `fix(security): close BS-1..BS-6 — add requireRole gates to RBAC, invoices, tasks, companies, reports, enrichment`
2. `fix(security): close BS-7..BS-15 — org-scope every mutating Prisma where clause`
3. `fix(security): close BS-16 — sanitise invoice export filename`
4. `fix(api): close BS-17 — restore httpErrors in api-versioning + idempotency plugins`
5. `fix(auth): close BS-18..BS-19 — drop spurious Microsoft writes; harden Clerk role mapping`
6. `fix(api): close BS-20..BS-21 — idempotency scope + bounded fallback`
7. `perf(api): close BS-22..BS-25 — bound list queries and narrow selects`
8. `chore(audit): close BS-26..BS-32 — sweep prior 2026-05-11 MAJORs`
9. `refactor(api): kick off BS-R1 — split dashboard.service.ts into widget modules`

After each commit, log any new mistake learned in [MISTAKES.md](MISTAKES.md) and add a `docs/solutions/*.md` entry if the fix was non-obvious (per `mistakes-protocol.md`).

---

## 8 · New issues discovered after this plan was written

Append below — don't renumber existing items.

- [ ] **BS-N1 (placeholder)** — _no new items yet_
