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

| #   | File                                                          | Lines | Priority | Strategy                                                                                                                                                            |
| --- | ------------------------------------------------------------- | ----- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `apps/api/src/services/crm/dashboard.service.ts`              | 1,752 | P1       | Extract: static widget defaults → `dashboard.defaults.ts`; company-enrichment logic → `company-enrichment.service.ts`; dashboard query fns → `dashboard.queries.ts` |
| 2   | `apps/web/src/pages/IntegrationsPage.tsx`                     | 1,423 | P2       | Extract: per-integration panels → `integrations/` subfolder (one file per provider); shared `IntegrationCard` component                                             |
| 3   | `apps/web/src/components/dashboard/OrgDashboard.tsx`          | 1,403 | P2       | Extract: widget components → `dashboard/widgets/` (one file per widget type); layout shell stays in `OrgDashboard.tsx`                                              |
| 4   | `apps/web/src/pages/AuditLogPage.tsx`                         | 1,203 | P3       | Extract: `AuditLogTable.tsx`, `AuditLogFilters.tsx`, `AuditLogDetail.tsx`                                                                                           |
| 5   | `apps/web/src/pages/OpportunitiesPage.tsx`                    | 956   | P3       | Extract: `OpportunityKanban.tsx`, `OpportunityFilters.tsx`, `OpportunityRow.tsx`                                                                                    |
| 6   | `apps/api/src/routes/invoices.ts`                             | 933   | P3       | Extract: PDF-generation handler → `invoices.pdf.ts`; payment-link handler → `invoices.payment.ts`; CRUD stays in `invoices.ts`                                      |
| 7   | `apps/api/src/services/ai-assistant.service.ts`               | 916   | P3       | Extract: tool-call dispatch → `ai-assistant.tools.ts`; context-building → `ai-assistant.context.ts`; main orchestration stays                                       |
| 8   | `apps/web/src/pages/ContactsPage.tsx`                         | 872   | P3       | Extract: `ContactTable.tsx`, `ContactFilters.tsx`, `ContactImportModal.tsx`                                                                                         |
| 9   | `apps/api/src/routes/rfp-nocobase.ts`                         | 834   | P4       | Extract: RFP template logic → `rfp-templates.ts`; scoring → `rfp-scoring.ts`                                                                                        |
| 10  | `apps/api/src/routes/opportunities.ts`                        | 834   | P4       | Extract: stage-transition helpers → `opportunities.transitions.ts`                                                                                                  |
| 11  | `apps/api/src/services/reports/sales-intelligence.service.ts` | 831   | P4       | Extract: chart data builders → `sales-intelligence.charts.ts`; summary builders → `sales-intelligence.summary.ts`                                                   |
| 12  | `apps/api/src/routes/territories.ts`                          | 816   | P1 ✅    | ~~Extract `A2_TO_A3` → `lib/geo/iso-country-codes.ts`~~ **Done Wave 10**                                                                                            |

---

## Completed splits

### `territories.ts` — Wave 10 (2026-05-28)

- Extracted `A2_TO_A3` (178 lines) → `apps/api/src/lib/geo/iso-country-codes.ts`
- `territories.ts` reduced from 816 → ~638 lines
- No behaviour change; import updated to named export

---

## Next up (P1)

### `dashboard.service.ts` split plan

```
apps/api/src/services/crm/
├── dashboard.service.ts          # orchestration only (~200 lines)
├── dashboard.defaults.ts         # DEFAULT_WIDGETS + static company data
├── dashboard.queries.ts          # all Prisma query functions
└── company-enrichment.service.ts # company enrichment pipeline
```

**Pre-conditions:**

1. Confirm no circular imports between the new modules.
2. Read full file (all 1,752 lines) before splitting.
3. Typecheck passes after extraction.

---

## Guiding principles for all splits

1. **Named exports only** — matches repo convention. No default exports in libs.
2. **No cross-module side effects** — module-level code initialises only pure data structures.
3. **Import from sibling, not parent** — new files import from `@bidstack/db`, `@bidstack/shared`, and local lib. No deep relative paths.
4. **Tests must still pass** — run `pnpm test` after every split.
5. **One file per PR** — keeps diffs reviewable. Do not batch multiple large-file splits in a single commit.
