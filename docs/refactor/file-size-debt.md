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
| 5   | `apps/web/src/pages/OpportunitiesPage.tsx`                    | 956   | P3       | Extract: `OpportunityKanban.tsx`, `OpportunityFilters.tsx`, `OpportunityRow.tsx`                                                                                                                                                                   |
| 6   | `apps/api/src/routes/invoices.ts`                             | 933   | P3       | Extract: PDF-generation handler → `invoices.pdf.ts`; payment-link handler → `invoices.payment.ts`; CRUD stays in `invoices.ts`                                                                                                                     |
| 7   | `apps/api/src/services/ai-assistant.service.ts`               | 916   | P3       | Extract: tool-call dispatch → `ai-assistant.tools.ts`; context-building → `ai-assistant.context.ts`; main orchestration stays                                                                                                                      |
| 8   | `apps/web/src/pages/ContactsPage.tsx`                         | 872   | P3       | Extract: `ContactTable.tsx`, `ContactFilters.tsx`, `ContactImportModal.tsx`                                                                                                                                                                        |
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

---

## Next up (P3)

## Guiding principles for all splits

1. **Named exports only** — matches repo convention. No default exports in libs.
2. **No cross-module side effects** — module-level code initialises only pure data structures.
3. **Import from sibling, not parent** — new files import from `@bidstack/db`, `@bidstack/shared`, and local lib. No deep relative paths.
4. **Tests must still pass** — run `pnpm test` after every split.
5. **One file per PR** — keeps diffs reviewable. Do not batch multiple large-file splits in a single commit.
