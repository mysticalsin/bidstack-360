# BS-R1 — File Size Debt Design Doc

**Date:** 2026-05-28  
**Status:** In progress  
**Ticket:** BS-R1  
**Rule violated:** CLAUDE.md §Quality — max file: 400 lines

---

## Overview

12 files exceed the 400-line cap. Each must be split into focused modules
with clear single responsibilities. This doc tracks the planned split
strategy and priority order.

**Constraint:** No behaviour changes during refactors. Every split must
preserve the existing API surface and pass typecheck + lint + tests.

---

## File inventory (descending size)

| #   | File                                                          | Lines | Priority | Strategy                                                                                                                                                                                                                                           |
| --- | ------------------------------------------------------------- | ----- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `apps/api/src/services/crm/dashboard.service.ts`              | 1,752 | P1 ✅    | ~~Split into 5 modules: dashboard.utils.ts / dashboard.defaults.ts / company-enrichment.service.ts / dashboard.cockpit.ts / dashboard.queries.ts~~ **Done Wave 10**                                                                                |
| 2   | `apps/web/src/pages/IntegrationsPage.tsx`                     | 1,423 | P2 ✅    | ~~Split into 9 modules: types.ts / integration-helpers.ts / IntegrationAtoms.tsx / IntegrationHero.tsx / ConnectionRunway.tsx / WebhookEventsCard.tsx / ConnectionCommandCenter.tsx / ConnectionTester.tsx / DustAgentsCard.tsx~~ **Done Wave 10** |
| 3   | `apps/web/src/components/dashboard/OrgDashboard.tsx`          | 1,403 | P2 ✅    | ~~Extract: widget components → `dashboard/widgets/` (one file per widget type); layout shell stays in `OrgDashboard.tsx`~~ **Done Wave 10**                                                                                                        |
| 4   | `apps/web/src/pages/AuditLogPage.tsx`                         | 1,203 | P3 ✅    | ~~Extract: `audit-log/audit-log-types.ts`, `audit-log/audit-log-helpers.ts`, `audit-log/AuditLogHero.tsx`, `audit-log/AuditLogInsights.tsx`, `audit-log/AuditLogFilters.tsx`, `audit-log/AuditLogTable.tsx`~~ **Done Wave 10**                     |
| 5   | `apps/web/src/pages/OpportunitiesPage.tsx`                    | 956   | P3 ✅    | ~~Extract: `OppInlineEditCells.tsx` (cells), `OpportunityRow.tsx` (row), `OppToolbar.tsx` (KPI bar + header + stage chips + bulk bar)~~ **Done Wave 10**                                                                                           |
| 6   | `apps/api/src/routes/invoices.ts`                             | 933   | P3 ✅    | ~~Extract: helpers + DB util → `invoices.helpers.ts`; streaming CSV + AR aging → `invoices.export.ts`; state transitions + payments → `invoices.payments.ts`; create + from-order → `invoices.mutations.ts`~~ **Done Wave 10**                     |
| 7   | `apps/api/src/services/ai-assistant.service.ts`               | 916   | P3 ✅    | ~~Extract: constants/types/Redis/Prisma utilities → `ai-assistant.helpers.ts`; Prisma context builders → `ai-assistant.context.ts`; main orchestration stays~~ **Done Wave 10**                                                                    |
| 8   | `apps/web/src/pages/ContactsPage.tsx`                         | 872   | P3 ✅    | ~~Extract: `ContactTable.tsx`, `ContactContextMenu.tsx`, `useContactsKeyboard.ts`~~ **Done Wave 10**                                                                                                                                               |
| 9   | `apps/api/src/routes/rfp-nocobase.ts`                         | 834   | P4       | Extract: RFP template logic → `rfp-templates.ts`; scoring → `rfp-scoring.ts`                                                                                                                                                                       |
| 10  | `apps/api/src/routes/opportunities.ts`                        | 834   | P4       | Extract: stage-transition helpers → `opportunities.transitions.ts`                                                                                                                                                                                 |
| 11  | `apps/api/src/services/reports/sales-intelligence.service.ts` | 831   | P4       | Extract: chart data builders → `sales-intelligence.charts.ts`; summary builders → `sales-intelligence.summary.ts`                                                                                                                                  |
| 12  | `apps/api/src/routes/territories.ts`                          | 816   | P1 ✅    | ~~Extract `A2_TO_A3` → `lib/geo/iso-country-codes.ts`~~ **Done Wave 10**                                                                                                                                                                           |

---

## Completed splits

### `territories.ts` — Wave 10 (2026-05-28)

- Extracted `A2_TO_A3` (178 lines) → `apps/api/src/lib/geo/iso-country-codes.ts`
- `territories.ts` reduced from 816 → ~638 lines
- No behaviour change; import updated to named export

### `dashboard.service.ts` — Wave 10 (2026-05-28)

- Split 1,752-line monolith into 5 focused modules:
  - `dashboard.utils.ts` (~280 lines) — pure stateless helpers; leaf node
  - `dashboard.defaults.ts` (~260 lines) — static constants + fallback factories
  - `company-enrichment.service.ts` (~210 lines) — CrmCompany entity builders
  - `dashboard.cockpit.ts` (~310 lines) — AccountCockpitSnapshot builder
  - `dashboard.queries.ts` (~270 lines) — Prisma wrappers + buildCompanyCockpit
- `dashboard.service.ts` reduced to ~370 lines (orchestration + backward-compat re-exports)
- Import DAG is acyclic; all external callers unchanged via re-export block
- Typecheck ✅ Lint ✅ (0 errors after auto-fix of type-import style)

### `IntegrationsPage.tsx` — Wave 10 (2026-05-28)

- Split 1,423-line monolith into 9 focused modules under `pages/integrations/`:
  - `types.ts` (144 lines) — all shared TS interfaces + `MCP_TOOLS` constant
  - `integration-helpers.ts` (211 lines) — pure functions: buildIntegrationSummary, webhookStatusTone, getPathDetail, defaultProbeUrl, readinessBadgeLabel, safeUrlPreview
  - `IntegrationAtoms.tsx` (160 lines) — stateless UI atoms: Stat, ProbeHint, EndpointBox, SnippetBox, CopyButton, ProbeResultCard
  - `IntegrationHero.tsx` (169 lines) — hero banner + metric cards
  - `ConnectionRunway.tsx` (65 lines) — 4-step workflow cards
  - `WebhookEventsCard.tsx` (114 lines) — webhook events table
  - `ConnectionCommandCenter.tsx` (279 lines) — connection path navigator + detail panel
  - `ConnectionTester.tsx` (190 lines) — endpoint probe UI
  - `DustAgentsCard.tsx` (67 lines) — Dust agents list
- `IntegrationsPage.tsx` reduced from 1,423 → 220 lines (queries + page layout only)
- Import DAG is acyclic; typecheck ✅ Lint ✅ (0 errors, 0 new warnings)

### `OrgDashboard.tsx` — Wave 10 (2026-05-28)

- Split 1,403-line monolith into 13 focused modules under `dashboard/widgets/`:
  - `dashboard-types.ts` (~80 lines) — shared types, tone token maps, stage helpers (leaf)
  - `KpiRow.tsx` (~130 lines) — 6-card KPI grid with trend indicators + signal bars
  - `InsightsBar.tsx` (~85 lines) — inline insight callouts (overdue / stalled / leads)
  - `WorkspaceHealthCard.tsx` (~110 lines) — SVG circular gauge with gradient stroke
  - `PipelineCard.tsx` (~160 lines) — live-chart sparkline + stage bars
  - `PipelineByStageMini.tsx` (~65 lines) — compact by-stage breakdown
  - `AlertCard.tsx` (~65 lines) — single-metric alert with progress arc
  - `SidebarCards.tsx` (~75 lines) — QuickActionsCard + QuickLinksCard (co-located)
  - `RecentActivityCard.tsx` (~135 lines) — animated activity feed
  - `TopAccountsCard.tsx` (~75 lines) — top-5 accounts list with CompanyLogo
  - `SalesFunnelCard.tsx` (~115 lines) — animated horizontal funnel bars
  - `WeeklyGoalCard.tsx` (~60 lines) — weekly pipeline goal progress bar
  - `WinRateCard.tsx` (~85 lines) — animated SVG ring chart
- `OrgDashboard.tsx` reduced from 1,403 → 357 lines (imports + orchestration + SourceStat)
- Import DAG is acyclic; dashboard-types.ts is leaf with zero local imports
- Typecheck ✅ Lint ✅ (0 errors, 0 new warnings from our changes)

### `AuditLogPage.tsx` — Wave 10 (2026-05-28)

- Split 1,203-line monolith into 6 focused modules under `pages/audit-log/`:
  - `audit-log-types.ts` (131 lines) — shared TS types + constants; leaf node, zero local imports
  - `audit-log-helpers.ts` (354 lines) — 28 pure functions + 3 explicit exported interfaces (AuditStats, EvidenceHealth, ActivityBucket)
  - `AuditLogHero.tsx` (114 lines) — hero banner + 5 metric cards (AnimatedMetric)
  - `AuditLogInsights.tsx` (152 lines) — activity cadence chart, forensic watchlist, evidence quality card
  - `AuditLogFilters.tsx` (192 lines) — search bar, date range, target type, quick-filter buttons, export/refresh controls
  - `AuditLogTable.tsx` (279 lines) — evidence stream table + co-located AuditRow with expand/collapse diff panel
- `AuditLogPage.tsx` reduced from 1,203 → 144 lines (URL state + React Query + cursor pagination only)
- Import DAG is acyclic; audit-log-types.ts is leaf; typecheck ✅ Lint ✅ (0 errors, 0 new warnings)

### `OpportunitiesPage.tsx` — Wave 10 (2026-05-28)

- Split 956-line monolith into 4 focused modules under `pages/opportunities/`:
  - `OppInlineEditCells.tsx` (184 lines) — StageCell (click-to-select with spring animation), NumberCell (number input with clamp), DateCell (date picker); leaf node, zero local sibling imports
  - `OpportunityRow.tsx` (244 lines) — private `UpdatedAgo` span (self-ticking, isolates timer re-render), memoised `Row` with per-field SavedFlash + confetti on Closed Won + SR announcements
  - `OppToolbar.tsx` (240 lines) — four co-located above-table sections: `OppKpiBar`, `OppPageHeader`, `OppStageChips`, `OppBulkBar`
- `OpportunitiesPage.tsx` reduced from 956 → 338 lines (URL state, sort, bulk-selection, data-fetching, thead/tbody shell)
- Import DAG is acyclic; OppInlineEditCells is the leaf, OpportunityRow imports from it, OppToolbar is independent, OpportunitiesPage imports all three
- Typecheck ✅ Lint ✅ (0 errors, 0 new warnings)

### `invoices.ts` — Wave 10 (2026-05-28)

- Split 933-line monolith into 5 focused modules:
  - `invoices.helpers.ts` (~185 lines) — Zod schemas (`ArAgingQuery`, `OptionalInvoiceTransitionBody`, `InvoiceUpdate`), pure utilities (`toPrismaState`, `isUniqueViolation`, `mintNextInvoiceNumber`, `resolveLineSubtotal`, `invoiceLineProductIds`, `loadInvoiceDetail`); leaf node, zero local imports
  - `invoices.export.ts` (~180 lines) — streaming cursor-paginated CSV (`reply.hijack()`, 200-row batches, 10K hard cap) + 4-bucket AR-aging report sub-plugin
  - `invoices.payments.ts` (~185 lines) — state transitions (`send`→`sent`, `cancel`→`cancelled` via shared for-loop), `/pay` (sets `paidAt` + mirrors `paidMicros`), `/payments` (partial payment with auto-pay) sub-plugin; fires `invoice.sent` / `invoice.paid` webhooks
  - `invoices.mutations.ts` (~170 lines) — `POST /invoices` (5-attempt retry loop guarded by `isUniqueViolation`) + `POST /invoices/from-order/:orderId` (copy lines from confirmed/done sales order) sub-plugin
- `invoices.ts` reduced from 933 → ~205 lines (`GET /invoices` list, `GET /invoices/:id` detail, `PATCH /invoices/:id`, and three sub-plugin registrations)
- Import DAG is acyclic; `invoices.helpers.ts` is the leaf; all external callers unchanged via same `invoicesRoutes` named export
- Typecheck ✅ Lint ✅ (0 errors, 0 warnings; fixed `Prisma` namespace as `import type`)

### `ai-assistant.service.ts` — Wave 10 (2026-05-28)

- Split 916-line monolith into 3 focused modules under `services/`:
  - `ai-assistant.helpers.ts` (~255 lines) — leaf node: constants (`DEFAULT_DAILY_CAP_MICROS`, `AI_MODEL`, token cost rates), 8 shared interfaces, Redis key helpers (`dailyCostKey`, `dailySessionKey`), `checkDailyCap`, `recordCost`, `sanitiseContactForPrompt`, `buildDustClient`, `estimateCost`, `persistSession`; zero local sibling imports
  - `ai-assistant.context.ts` (~195 lines) — Prisma context builders: `buildEmailDraftContext`, `buildSentimentContext`, `buildMeetingContext`, `buildEnrichContext`, `buildAccountIntelContext`; imports from helpers, Zod (attendee parsing), `@bidstack/db`; throws `{ statusCode: 404 }` on not-found entities
  - `ai-assistant.service.ts` (~310 lines) — pure orchestrator: cap-check → context → prompt → Dust/stub → parse → persist; zero direct Prisma/Redis/Zod imports
- Import DAG is acyclic: `helpers` (leaf) ← `context` ← `service`
- Route file (`ai-assistant.ts`) unchanged — imports same 5 exported function names
- Typecheck ✅ Lint ✅ (0 errors, 0 warnings)

### `ContactsPage.tsx` — Wave 10 (2026-05-28)

- Split 872-line monolith into 4 focused modules under `pages/contacts/`:
  - `ContactContextMenu.tsx` (~155 lines) — WAI-ARIA right-click menu (role=menu, arrow nav, Home/End, Tab close, Escape via document listener, viewport clamping); leaf node, zero local sibling imports
  - `useContactsKeyboard.ts` (~95 lines) — vim-style keyboard nav hook (j/k/arrows, gg/G, Enter/x/Space, ⌘E); pendingG ref for gg chord; deps `[items, cursorIdx, quickLook]` match original exactly; leaf node
  - `ContactTable.tsx` (~330 lines) — aria-live `<p role="status">` + `<Card>` with loading/error/empty/populated states; exports `ContactSortKey`, `ContactSortState`, `ContactTableProps`; uses `ReadonlyArray<Contact>` for items + raw props
- `ContactsPage.tsx` reduced from 872 → ~310 lines (URL-persisted sort, bulk selection, data-fetching, handler logic only)
- Import DAG is acyclic; ContactContextMenu + useContactsKeyboard are leaf nodes
- Typecheck ✅ Lint ✅ (0 errors, 0 warnings)

---

## Next up (P4)

## Guiding principles for all splits

1. **Named exports only** — matches repo convention. No default exports in libs.
2. **No cross-module side effects** — module-level code initialises only pure data structures.
3. **Import from sibling, not parent** — new files import from `@bidstack/db`, `@bidstack/shared`, and local lib. No deep relative paths.
4. **Tests must still pass** — run `pnpm test` after every split.
5. **One file per PR** — keeps diffs reviewable. Do not batch multiple large-file splits in a single commit.
