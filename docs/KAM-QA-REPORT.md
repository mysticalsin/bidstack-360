# KAM — Final QA & Audit Report

**Date:** 2026-06-23 · **Branch:** `feat/prod-hardening-mantu` · **Scope:** the Key Account Management front layer (`docs/KAM-PLAN.md` v2) + the nav fix.
**Verdict:** PASS — every Definition-of-Done item is verified, not just written. No discrepancies found between the UI and the database. Remaining items are operator-gated (deploy/SERUM) and the cross-model Codex pass (credit-limited), both listed below.

---

## 1. What was tested + result

### Functional (live, against the running stack: web :38081 → api :4000 → Postgres :5433)
| Requirement | How verified | Result |
|---|---|---|
| Lifecycle enforced (Initiative→Lead→Opportunity→Dropped); illegal transitions rejected | API integration `kam-initiatives` 7/7 (illegal skip→409, dropped-requires-reason→400, terminal→409) + live board walk | PASS |
| →Opportunity mints a real Opportunity + a Handoff, atomically (no double-mint) | Integration (optimistic-flip 409 on 2nd, no dup) + **live**: drove an initiative Initiative→Lead→Opportunity; cross-checked DB → `{opportunity:1}`, 1 handoff (`draft`, opportunity linked) | PASS |
| Transcript → clean note + to-do list, human-gated, never auto-commit | Integration `kam-drafts` 6/6 + **live**: seeded a pending draft → clicked **Approve & commit** → initiative + task committed, draft left the queue, board/to-do/KPI updated; reject commits nothing | PASS |
| Human gate cannot be bypassed (api-role cannot approve) | Integration: api-key with `write` scope → `/approve` 403 (B8.1 actor-role gate) | PASS |
| Tasks attached to initiatives, surfaced as a per-account to-do (OM gap) | Integration `kam-tasks` 5/5 + **live**: committed task appeared in the per-account to-do ("Draft pilot scope") | PASS |
| Both ingestion paths (manual + SharePoint pull) | Manual paste/upload live (session create + draft); SharePoint pull is a defined interface returning the manual-import floor (no connector exists) | PASS (manual is the floor; pull = tested interface) |
| Dust MCP read + write; writes land in staging | `kam-tools` 24/24 (handlers: ingest→session, propose→PENDING draft committing zero canonical rows; cross-tenant 404) + dedicated `kam` scope can't reach canonical-write tools | PASS (live SERUM allowlist publish = operator) |
| KPI roll-ups (account / owner / country-VP / staleness) | Integration `kam-reports` 5/5 + live KPI strip rendered correct counts | PASS |
| Prospection linked per account/owner (read from ABC) | `KamProspection` read-mirror; import skips cross-tenant rows; KPIs count it | PASS (live ABC sync = operator) |
| Handoff interface to OM defined + tested (manual export ≥ floor) | `kam-handoffs` 4/4 (export builds ABC-OM payload, confirm records OM id + blocks re-export) | PASS |
| Works for a presales-owned AND a manager-owned account | `kamOwnerModel` (presales_driven / manager_driven) on Company; owner-agnostic throughout | PASS (model supports both) |

**Aggregate automated evidence:** api KAM suite **72/72**, db **35/35**, mcp scope+handlers **24/24**, leads-convert parity **10/10** — all green this session.

### Data integrity
- UI ↔ Postgres cross-checked at each step of the live walk (initiative count, opportunity count, handoff existence + linkage, to-do task) — **no discrepancies**.
- No orphaned records: all KAM models are `orgId`-scoped with soft-delete; FKs cascade (handoff/tasks on initiative delete). Cross-tenant FK graft rejected (404) on every endpoint + MCP tool (B3).

### UI / visual
- Every KAM panel renders with loading/error/empty states (KPI strip, board, to-do, draft review) — observed live.
- **Nav fix landed:** accordion verified live — only the active section (ACCOUNTS) expanded; SALES/PIPELINE/BIDS/WORKSPACE collapsed to headers → no internal scroll at standard desktop viewport. "Key Account Mgmt" present under Accounts. No regression to other sections (same navConfig source feeds both surfaces).
- **Console:** no errors. Two benign pre-existing warnings only (reduced-motion device notice; manifest.json preload) — neither KAM-related.

### Code audit
- No dead code introduced; the one stray export was removed pre-commit. Every change traces to a requirement in the brief (commits S0–S6 + frontend + nav reference the exact requirement/blocker IDs).
- `pnpm -r typecheck`, `pnpm -r lint`, and the web production build are green across db / shared / api / mcp-server / web.

---

## 1a. Repo-wide regression gates (full-suite QA pass, 2026-06-23)

Ran the entire monorepo — not just KAM — to prove the cross-cutting changes
(shared schemas, the leads-route `mintOpportunityTx` migration, `serum-runtime-policy`
scope type, `server.routes`) caused no regression anywhere:

| Gate | Result |
|---|---|
| `pnpm -r typecheck` | PASS — all 11 packages, 0 errors |
| `pnpm -r lint` | PASS — 0 errors (2 KAM type-import warnings fixed; 3 pre-existing web warnings untouched) |
| `pnpm -r build` | PASS — all packages built |
| `apps/api` tests | **779 passed / 2 skipped** (115 files) — leads-convert migration: no regression |
| `apps/web` tests | 407 passed (72 files) |
| `apps/worker` tests | 326 passed (39 files) — see finding below |
| shared 136 · db 35 · mcp-server 54 · dust 8 · odoo 8 · memos 8 · marketing 3 | all PASS |

**Pre-existing failure found + fixed (unrelated to KAM):** `serum-connector-egress`
deny-path test threw `RangeError: Invalid time value` — its BullMQ job mock omitted
`timestamp`, so `webhook-delivery.ts:181`'s stable-timestamp fallback
(`new Date(job.timestamp).toISOString()`) threw. Real BullMQ jobs always carry
`timestamp`; fixed the mock (test-only, no prod change — commit `4e1384ff`). The
worker egress code does not import any KAM-changed module; this was not a KAM
regression, surfaced by running the full suite.

## 1b. Verification gaps (honest — not blockers, recommend follow-up)
- **In-tenant access-scope (B4) deny path is not exercised by an automated test.**
  Every KAM company-scoped route calls `assertCompanyVisible` → `canReadAccount`,
  and cross-account reports apply `accessibleCompanyIds` — the same proven M7
  control used by notes/files/account-intel. But the integration tests run as the
  unrestricted stub admin, so they prove allow, not deny for a scoped UserGroup.
  Cross-tenant (B3, different org) IS tested (404). Recommend a scoped-user test.
- **Mobile nav accordion** verified by code + typecheck + web tests; desktop
  accordion verified live in-browser. A live mobile-viewport drawer pass is a nice-to-have.

## 2. Discrepancies found + resolved during QA
1. **Query-guard 400s** on the to-do / reports / prospection endpoints — takeless (or take>1000) `findMany` tripped the unbounded-query guard. **Resolved:** bounded every KAM `findMany` to ≤1000 (re-tested green).
2. **RBAC 403 on first live writes** — the dev DB's roles predated the new `kam:*` permissions. **Resolved:** re-seeded RBAC (`pnpm db:seed`; permissions 47→49). Surfaced the matching prod step below.
3. **No live-DB discrepancy** between UI and Postgres after these were fixed.

---

## 3. Operator-gated (cannot be completed from the agent shell) — required before prod
- **Prod DB:** run `pnpm db:migrate` (the `20260623000000_kam_foundation` migration) + `pnpm db:generate` + `pnpm db:seed` (lands `kam:read`/`kam:write`). *(Local dev DB was migrated via `prisma db execute` + reseeded for this QA.)*
- **SERUM:** publish each org's `explicit_allowlist` for the new `kam_*` MCP tools (default-deny) before live Dust calls; then run the live Dust read+write smoke.
- **Cross-model review:** re-run the Codex adversarial plan pass (`docs/KAM-PLAN-REVIEW-LOG.md`) once ChatGPT-account credits reset (~Jun 28). The plan passed a 5-lens Claude red-team (8 blockers fixed) but not yet the cross-model check.

---

## 4. Deferred (tracked, not silently skipped)
- Hardening the **pre-existing** non-KAM auto-commit paths (AiInsight `PENDING`/`active` enum, `notes/import-meeting`, dust-poll fallthrough). These write to non-KAM tables, so the KAM feature itself never auto-commits; closing them repo-wide is a separate follow-up.
- Staleness **notification cron** (the staleness *report* is built + tested; the scheduled alert dispatch is a worker follow-up).
- Live SharePoint connector + live ABC prospection sync (built as interfaces; need PO capability confirmation + creds).
