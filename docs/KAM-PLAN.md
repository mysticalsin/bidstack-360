# KAM (Key Account Management) — Technical Brief / Build Plan (v2)

**Status:** v2 — revised after 5-lens adversarial red-team (8 blockers + 9 majors adopted). Codex cross-model pass pending (credit reset ~Jun 28). Building under autonomous /loop.
**Branch:** `feat/prod-hardening-mantu`. KAM commits are KAM-scoped (no bulk-add of unrelated WIP).
**Date:** 2026-06-23.
**Discipline:** /goal + software-factory. Smallest correct implementation; reuse > rebuild; tenant isolation, in-tenant access-scope, auditability, RBAC, PII, a11y, perf preserved.

---

## 0. Decisions locked with Tony

1. **OM is a section *inside* ABC** (Opportunities-management; traces lead→need→win). ABC = system of record. Handoff = a **write into ABC's OM section**; **manual structured export now, live API later**. Prospection **read from ABC**.
2. **Both ingestion paths** (SharePoint pull *interface* — manual is the working floor; live connector unverified — and manual paste/upload). Dust agents drive ingest + propose-to-staging via **new MCP tools** under a dedicated `kam` scope.
3. **Scope:** everything buildable now; defer only live external wiring (ABC/OM API, SharePoint live connector, live Dust allowlist publish).
4. **Initiative→Opportunity boundary:** reaching `opportunity` mints a real local `Opportunity` (via a NEW extracted `convertLeadTx`) **and** writes a `KamHandoff`, **all in one transaction guarded by an optimistic stage flip**. KAM is the front layer; the pipeline stays deal system-of-record. **Do NOT rebuild OM.**

### 0a. Defaults applied for red-team disagreements (Tony can override)
- **D1 — `InitiativeStage` is a fixed 4-value enum** (Tony locked the vocab; brief says "do not rename"). Not per-org configurable.
- **D3 — `kam_update_task_status` stays a direct (audited, scope-validated) write** on an *existing* KAM task — the brief explicitly lists "update task status" as a required MCP write. Status flip on an existing task ≠ unreviewed content creation. Documented carve-out.

### 0b. Brief-vs-reality (recon)
- **Prisma 5 + PostgreSQL 16**, NOT Supabase. Tenancy = app-layer `org_id` (no RLS). Money in micros.
- **MCP write already exists**; what's missing is **KAM-shaped, human-gated *staging* writes**.
- **No SharePoint connector exists.** `dust-client` = Dust data-sources only.
- **Two divergent convert implementations exist:** `leads.write.routes.ts:256-383` (inline, atomic, optimistic flip, 4-retry) and `apps/mcp-server/src/tools/leads-convert.ts` (non-atomic two-phase, no retry → can double-mint). **Canonical = a NEW extracted `convertLeadTx`; migrate both onto it; the MCP convert is a pre-existing bug to fix/quarantine.**
- **Never-auto-commit has 4 live bypass paths** (write-scoped MCP tools; dust-poll fallthrough `upsertNoteFromDust`; webhook-processor `AiInsight` inherits `@default(active)`; `POST /notes/import-meeting` auto-commits) — all closed **within KAM scope**, not just flagged.
- **Account identity is split-brain:** the cockpit builds accounts from opportunities/enrichments with name-slug/enrichment-uuid ids; governance/contract/cross-sell/project-ref key on `accountKey = normalizeName(name)`; two normalizers disagree (`account-access.normalizeAccountSlug` `/^-+|-+$/g` vs `dashboard.utils.normalizeName` `/^-|-$/g`).

---

## 1. Account identity resolution (B5/M5 — gates everything)

- **KAM accounts ARE real `Company` rows.** All KAM entities **FK to `Company.id`** (exact internal identity; KAM-native KPIs — initiatives/tasks/sessions — join purely on `Company.id`).
- **Cross-surface KPI joins** (to governance/contract/cross-sell/project-ref/prospection, which are `accountKey`-keyed) derive the key via **ONE shared `normalizeAccountName(name)` exported from `@bidstack/shared`**. Unify the two divergent regexes into this single function; add a test asserting both old regexes are gone and that both former call-sites import the shared one.
- **Legacy name-keyed data** (`Note.accountId` free-text, `AiInsight` by `normalizeName(companyName)`): backfill `companyId` where a unique `Company` name match exists; otherwise cross-surface counts are labeled **best-effort** in the UI. KAM-native data is always exact.
- KAM account picker selects an existing `Company` (or creates one). No new Account table.

---

## 2. Data model (Prisma) — additive only, ALL in one S0 migration

Every new model: `orgId @db.Uuid`, `@@index([orgId, …])`, `deletedAt` soft-delete, `createdAt/updatedAt`. Migration order: Company alters → KamConsultant/KamSession → KamInitiative → KamSessionDraft/KamHandoff/KamProspection → Task alters → AiInsight alters. **One migration, one regen** (B8.3/m7).

### 2.1 New enums
```prisma
enum InitiativeStage  { initiative  lead  opportunity  dropped       @@map("initiative_stage") }
enum KamAccountStatus { identified  kickoff  mapped  active  paused  closed  @@map("kam_account_status") }
enum KamOwnerModel    { presales_driven  manager_driven              @@map("kam_owner_model") }
enum KamSessionSource { manual_paste  manual_upload  sharepoint_pull  call_recording  dust_push  @@map("kam_session_source") }
enum KamDraftStatus   { pending  approved  rejected                  @@map("kam_draft_status") }
enum KamHandoffStatus { draft  exported  confirmed                   @@map("kam_handoff_status") }
enum AiInsightStatus  { pending  active  rejected                    @@map("ai_insight_status") }  // M7 — replaces free-text
```
**`ALLOWED_TRANSITIONS`** (shared const, M2): `initiative→[lead, dropped]`; `lead→[opportunity, dropped]`; `opportunity→[]` (terminal); `dropped→[]` (terminal, no re-open in v1). Board disables drag out of Opportunity/Dropped.
Reuse `LeadPriority`, `TaskStatus`. (D2 noted: `LeadPriority` semantic reuse accepted.)

### 2.2 `Company` — additive
```prisma
kamStatus         KamAccountStatus @default(identified) @map("kam_status")
kamOwnerModel     KamOwnerModel?   @map("kam_owner_model")   // Spain=presales_driven, CH=manager_driven
directorSponsorId String?          @map("director_sponsor_id") @db.Uuid   // User FK (org-validated on write)
```

### 2.3 `KamConsultant` — `companyId` FK, `name`, `department?`, `switchedOn Boolean @default(false)`, `engagementNotes?`, `contactId?`, `email? @db.Citext` + `emailHash?` (**added to `PII_MAP`**, B6), `aiOptOut Boolean @default(false)`. Index `[orgId, companyId, switchedOn]`.

### 2.4 `KamSession` — `companyId` FK, `title?`, `heldAt`, `sourceType KamSessionSource`, `sourceRef String?` (typed pointer — **resolved via `findFirst({id, orgId})` before any read**, m3), `attendees String[]` (display names; plaintext PII — see ADR note), `consultantIds String[]`, `transcriptText String?` (**plaintext-at-rest PII**: access-scoped + audited; the transcript is the AI input so it is sent to the model by design; per-consultant `aiOptOut` excludes that person's PII from *enrichment* prompts), `transcriptStructured Json?`, `aiNote Json?`, `aiNoteStatus KamDraftStatus @default(pending)`, `committedAt?`, `createdById`. Index `[orgId, companyId, heldAt desc]`. **In `PII_MAP`** for `email`-bearing future fields; transcript/attendees documented as plaintext PII in `docs/solutions/kam-pii.md` (ADR).

### 2.5 `KamInitiative` (core) — `companyId` FK, `sessionId? FK`, `title`, `description?`, `stage InitiativeStage @default(initiative)`, `ownerId? (User)`, `priority LeadPriority @default(medium)`, `estimatedValueMicros BigInt?` (set at `lead`), `lastActivityAt @default(now())`, `droppedReason?`, `convertedToOpportunityId? @db.Uuid`, `handoffId? @db.Uuid`, `createdById`. Indexes `[orgId, companyId, stage]`, `[orgId, stage, lastActivityAt]`, `[orgId, ownerId]`.

### 2.6 `Task` — additive: `initiativeId? @db.Uuid` (FK KamInitiative, onDelete Cascade), `accountId? @db.Uuid` (FK Company), `type String?`. Keep `oppId`. Indexes `[orgId, initiativeId]`, `[orgId, accountId, status, dueDate]`. 1–3/initiative = service-layer soft validation + UI hint (warn at 0 or >3), not a DB constraint.

### 2.7 `KamSessionDraft` (human gate) — `companyId` FK, `sessionId FK`, `status KamDraftStatus @default(pending)`, `source String`, `noteDraft Json`, `taskDrafts Json`, `initiativeDrafts Json`, `lowConfidence Json` (garbled proper nouns, never guessed), `confidenceBps?`, `warnings Json`, `createdById?`, `reviewedById?`, `reviewedAt?`. **Approve guarded by `updateMany({where:{id, orgId, status:'pending'}})` count-check inside the commit tx** (m2). KamSessionDraft is a genuinely new pattern (not "mirrors contract-extraction").

### 2.8 `KamHandoff` — `companyId` FK, `initiativeId FK`, `opportunityId? @db.Uuid`, `status KamHandoffStatus @default(draft)`, `targetSystem String @default("abc_om")`, `exportPayload Json`, `externalRef String?`, `exportedAt?`, `exportedById?`, `createdById`. Created atomically with the →opportunity mint. Index `[orgId, companyId]`, `[orgId, status]`.

### 2.9 `KamProspection` (READ-MIRROR of ABC, not SoR) — `externalId String?` (**required for `source='abc'` rows**; null only for manual), `id UUID` PK (manual rows keyed by UUID), `companyId? FK`, `ownerId? (User)`, `actionType String`, `occurredAt`, `linkedTaskId?`, `linkedInitiativeId?`, `source String @default("abc")`, `syncBatchId String?`, `syncedAt`, `deletedAt`. **Unique `[orgId, source, externalId]` (partial, where externalId not null).** Reconcile-on-absent: rows missing from a sync batch are soft-deleted. **KPIs exclude soft-deleted/stale rows.** Manual import stamps `orgId` from caller, validates `companyId/linked*` ownership (m4).

### 2.10 `AiInsight` — additive (M7/m5): replace free-text `status` with `AiInsightStatus` (lowercase `pending/active/rejected`); add `reviewedById?`, `reviewedAt?`. Migrate existing rows (`'PENDING'`→`pending`, `'active'`→`active`). Dashboard reads only `active`. Writers (`calls.ts`, `webhook-processor.ts`) write `pending`; schema default flips to `pending`. New accept endpoint promotes `pending→active`.

---

## 3. API (Fastify) — invariant block FIRST

**Every KAM route MUST, before any write:**
1. **FK-graft guard (B3):** load *each* body/param foreign id (`companyId`, `sessionId`, `initiativeId`, `opportunityId`, `consultantIds[]`, `directorSponsorId`, `ownerId`, `assigneeId`, `sourceRef`, `linkedTaskId`, `linkedInitiativeId`) via `findFirst({where:{id, orgId:req.auth.orgId, deletedAt:null}})`; 404 on miss. (Mirror `tasks-update.ts:31-34`, `oppBelongsToOrg`.)
2. **Access-scope (B4):** company-scoped reads/writes call `ensureAccountVisible(companyId)`; lists/KPIs apply `applyCompanyScope(where, getAccessScope(...))`.
3. **Audit:** mutations write `AuditLog` in the same tx.

Routes: `kam-accounts.ts` (account KAM fields + consultant CRUD), `kam-initiatives.ts`, `kam-tasks.ts`, `kam-sessions.ts`, `kam-drafts.ts`, `kam-handoffs.ts`, `kam-reports.ts` (S6). Shared zod in `packages/shared/src/schemas/kam-*.ts`.

### 3.1 `convertLeadTx` extraction (B1) — S1 prerequisite
Extract `convertLeadTx(tx, {orgId, userId, companyId, customer, name, valueMicros, ownerId, …})` from `leads.write.routes.ts:256-383` into a shared service (`apps/api/src/services/opportunities/convert.ts`). Migrate `POST /leads/:id/convert` onto it (behavior-preserving; existing tests stay green). KAM transition calls it. Fix or quarantine `mcp-server/leads-convert.ts`.

### 3.2 `POST /kam/initiatives/:id/transition` (B2/M1/m1)
Single `$transaction`:
1. Optimistic flip: `updateMany({where:{id, orgId, stage:fromStage, convertedToOpportunityId:null, deletedAt:null}, data:{stage:toStage, lastActivityAt:now}})`; if `count===0` → **409** (lost update / illegal / already-converted).
2. Reject if `toStage ∉ ALLOWED_TRANSITIONS[fromStage]` (pre-check + the guard above).
3. If `toStage==='opportunity'`: `convertLeadTx` mint with `companyId=initiative.companyId`, `customer=company.name`, `valueMicros=initiative.estimatedValueMicros`; create `KamHandoff`; set `convertedToOpportunityId`/`handoffId`.
4. If `toStage==='dropped'`: require `droppedReason`.
5. `Activity(type='stage_change', entityType='kam_initiative', idempotencyKey=`${id}:${from}->${to}`)` + `AuditLog`, same tx.

### 3.3 Human gate + bug fixes
- **`/kam/drafts/:id/approve` (B8.1):** gate on `req.auth.userId` present **AND** `req.auth.role !== 'api'` — api-role callers **forbidden**. Do NOT rely on `kam:write` (scope-collapse makes it agent-passable). Approve = the only commit path (creates Initiatives/Tasks/note in one tx, guarded by the pending count-check).
- **AiInsight (B7c/M7):** webhook-processor + calls write `pending`; schema default `pending`; dashboard reads `active`; accept endpoint promotes.
- **import-meeting (B7d/M8):** when `companyId` resolves to a KAM account, write a `KamSessionDraft` instead of auto-commit; legacy auto-commit only behind an explicit non-KAM flag.
- **dust-poll (B7b):** KAM-tagged docs route to `KamSessionDraft` (no `upsertNoteFromDust` fallthrough).

### 3.4 RBAC (B8.1) — 3-file lockstep in S0
Add `kam:read`/`kam:write` to **(1)** `PERMISSION_KEYS` (shared), **(2)** `PERMISSION_SEEDS` + role grants (db seed — runtime authority), **(3)** `RBAC_MATRIX`/`ALL_READ`/`ALL_WRITE`/`MATRIX_RESOURCES`. Add a test: `set(PERMISSION_KEYS) === set(PERMISSION_SEEDS.keys)`. Operator runs `db:seed`.

---

## 4. MCP tools (apps/mcp-server) — dedicated `kam` scope

**New `kam` MCP scope = read + staging-write ONLY; does NOT satisfy canonical-write tools** (B7a). Existing canonical-write tools stay out of `kam` scope. Every `kam_*` write handler applies the §3 FK-graft + access-scope guards with `ctx.orgId`.

**S5 (staging only):** `kam_list_accounts`, `kam_get_account`, `kam_list_initiatives`, `kam_list_tasks` (read); `kam_ingest_transcript`, `kam_propose_session_draft` (write→staging); `kam_update_task_status` (audited carve-out, existing KAM task, §0a-D3).
**S6:** `kam_read_prospections`, `kam_log_prospection`, `kam_get_kpis` (depend on S6 models — M9).

**4 registration sites per tool (B8.2):** `index.ts tools`, `index.ts toolScopes`, `db/serum-runtime-policy.ts MCP_TOOL_SCOPES` (un-mapped read tool silently becomes `write` via `?? 'write'` — assert every tool is mapped), org `explicit_allowlist` (SERUM default-deny). **DoD = unit-tested against a mocked SERUM allow-decision; live allowlist publish + Dust end-to-end smoke = operator handoff (Constraint C).** Tools to allowlist: list them in the handoff doc.

---

## 5. Reporting / KPIs (S6)
Per account / per owner / per country (VP roll-up) / staleness (no task activity in N days, default 14 → flag + notification). KAM-native metrics join on `Company.id`; cross-surface (governance/prospection) join via shared `normalizeAccountName`. All KPI queries apply `applyCompanyScope`. Stale/soft-deleted prospections excluded. Cockpit cards + KAM KPI view.

---

## 6. Frontend
Initiative board (reskin `LeadKanbanView`; drag calls the guarded transition; illegal/terminal moves disabled). Per-account to-do card. Session review (transcript viewer + editable note + extracted to-do + **Approve/Reject**; low-confidence nouns highlighted). Consultant map. KPI dashboard. Dark mode, WCAG 2.2 AA, 44px, all states, reduced-motion. Match existing design language.

---

## 7. Nav fix (separate change set)
App-global (`navConfig.ts` → `Sidebar.tsx` + `index.css .sb-*` + `MobileNav.tsx` + `stores/ui.ts`). Remove internal scroll at desktop viewport via IA (collapse/group/prioritize). **Before/after for Tony sign-off BEFORE shipping.** Keep section keys stable; no px width hard-code on `.sidebar`; no width transition on `.app-shell`; preserve `data-tour='nav-sidebar'`; no new aesthetic; no regressions. KAM as cockpit cards + at most one nav entry.

---

## 8. Build sequence (green-gate each)
- **S0** — ALL KAM migrations (one file, FK order) + Company/Task/AiInsight alters + enums + shared `normalizeAccountName` + 3-file RBAC lockstep + `set==set` test. Regen ONCE here. **Model-touching later slices are "typecheck-deferred" until this regen succeeds** (resolves Constraint-A contradiction).
- **S1** — extract `convertLeadTx` (migrate leads route + tests) → KamInitiative + guarded transition + board.
- **S2** — Task fields + lastActivityAt blind-set helper (used by task CRUD, transition, draft-approve) + per-account to-do.
- **S3** — KamSession + KamSessionDraft + ingest (manual + SharePoint interface) + AI-organize→draft + approve/reject (only commit path) + AiInsight fix + dust-poll/import-meeting gates.
- **S4** — KamHandoff export (covered structurally in S1's transition; S4 = export endpoint + UI + idempotency test).
- **S5** — `kam` MCP scope + staging tools (4 registration sites; mocked-SERUM unit tests).
- **S6** — KamProspection sync/manual + KPI rollups + staleness + prospection/KPI MCP tools.
- **Nav** — parallel/independent, gated on sign-off.

---

## 9. Verification + constraints (fail-loud)

**Agent-verifiable now:** `pnpm -r typecheck` (after regen), `pnpm -r lint`, `pnpm test` (unit/component vs mocks — transition guard rejects illegal + double-mint 409; FK-graft 404; gate forbids api-role; AiInsight status; draft double-approve; convertLeadTx parity), `pnpm build`, component a11y.
**Operator-gated (Constraint B — `DATABASE_URL` not reliably in agent shell; Postgres is up on :5433 so the running stack may allow live smoke):** `db:migrate`/`db:generate`/`db:seed`; full lifecycle walk both ingestion paths × presales-owned AND manager-owned account; Postgres cross-check; SERUM allowlist publish + live Dust smoke.
**Constraint A — Windows Prisma regen DLL lock:** one regen point at S0; attempt after killing dev watchers; if locked, ship schema+migration+code and hand off regen.
**Constraint C — external integrations** (ABC/OM API, SharePoint live, live Dust allowlist) unverifiable here → tested interfaces + manual floors + operator handoff doc.

---

## 10. Out of scope
Competing CRM / duplicate OM pipeline; full transcript→commit automation (human gate stays); new prospection tracking (read from ABC); new nav aesthetic; anything not traceable to the KAM brief.
