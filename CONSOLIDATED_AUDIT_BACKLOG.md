# Consolidated Audit Backlog — BidStack 360°

**Date:** 2026-05-27  
**Sources:** Backend API Audit + Integration Flow Audit + Frontend Polish Audit  
**Total Findings:** 57 issues catalogued across 3 swarm agents

---

## 🔴 P0 — Fix Immediately (Security / Crash / Data Leak)

| #   | Issue                                                                                                                                                                                                                           | File(s)                                                                      | Effort | Source      |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------ | ----------- |
| 1   | **Fire-and-forget promises kill the API process** — `void fanOutWebhookEvent()`, `void pushOpportunityToDust()`, `void pushLeadToDust()` are unhandled. `main.ts` binds `process.on('unhandledRejection')` → `process.exit(1)`. | `apps/api/src/main.ts`, multiple routes                                      | S      | Backend     |
| 2   | **Logout never clears React Query cache** — `bidstack:session` localStorage key is never set, so `watchAuthForCacheClear` never fires. Next user sees previous tenant's data.                                                   | `apps/web/src/lib/auth.tsx`, `queryCache.ts`                                 | S      | Integration |
| 3   | **Frontend CSV export only exports current page** (≤50 rows) despite backend having streaming endpoints for 10k+ rows. Users believe they exported everything.                                                                  | `InvoicesPage.tsx`, `OpportunitiesPage.tsx`, `SalesOrdersPage.tsx`           | S      | Integration |
| 4   | **Silent owner-update failure** — If `req.body.owner` email doesn't exist, `findFirst()?.id` returns `undefined`, Prisma ignores it, owner silently unchanged.                                                                  | `apps/api/src/routes/opportunities.ts`                                       | S      | Backend     |
| 5   | **Custom-field upserts outside parent transactions** — CF upserts run after `$transaction` commits. CF failure = partial update / data corruption.                                                                              | `companies.ts`, `opportunities.ts`, `invoices.ts`, `leads.ts`, `contacts.ts` | S–M    | Backend     |
| 6   | **Opportunity count includes soft-deleted rows** — Missing `deletedAt: null` skews KPIs and badges.                                                                                                                             | `apps/api/src/routes/opportunities.ts`                                       | XS     | Backend     |

---

## 🟠 P1 — High Impact (Performance / UX / Data Consistency)

| #   | Issue                                                                                                                                             | File(s)                                | Effort | Source      |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- | ------ | ----------- |
| 7   | **Contact CSV import fires unbounded concurrent requests** — 200 rows = 200 simultaneous POSTs.                                                   | `ContactCsvImportDialog.tsx`           | S      | Integration |
| 8   | **AR Aging stale after payment** — `useRecordPayment` never invalidates `['ar-aging']`.                                                           | `useInvoices.ts`                       | XS     | Integration |
| 9   | **Opportunity create misses dashboard invalidations** — Misses `['opportunityCount']`, `['crm-dashboard']`, `['forecasts']`, `['goals']`.         | `CreateOpportunityDialog.tsx`          | XS     | Integration |
| 10  | **Lead convert misses pipeline invalidations** — Misses `['opportunityCount']`, `['crm-dashboard']`, `['pipeline-report']`.                       | `useLeads.ts`                          | XS     | Integration |
| 11  | **Company hierarchy N+1 query** — Recursive `buildTree()` issues one `findMany` per node.                                                         | `apps/api/src/routes/companies.ts`     | M      | Backend     |
| 12  | **Opportunity import sequential loop** — 100 rows = 300+ queries.                                                                                 | `apps/api/src/routes/opportunities.ts` | M      | Backend     |
| 13  | **Dashboard snapshot loads 200+ rows into memory** — Omits `deletedAt: null` on most queries.                                                     | `dashboard.service.ts`                 | S–M    | Backend     |
| 14  | **Accounts routes fetch up to 1,000 rows** — No pagination on `/accounts/key` and `/accounts/top`.                                                | `apps/api/src/routes/accounts.ts`      | M      | Backend     |
| 15  | **Sales intelligence loads 500+ rows into memory** — No pagination or streaming.                                                                  | `apps/api/src/routes/reports.ts`       | M      | Backend     |
| 16  | **AR aging loads 1,000 invoices into JS memory** — Should be a single grouped SQL query.                                                          | `apps/api/src/routes/invoices.ts`      | S      | Backend     |
| 17  | **MCP server unbounded session Maps** — `streamableTransports` and `sseTransports` leak on unclean disconnect.                                    | `apps/mcp-server/src/server.ts`        | S      | Integration |
| 18  | **Dust push zero retry** — Network hiccup = record never re-synced.                                                                               | `apps/api/src/lib/dust-push.ts`        | M      | Integration |
| 19  | **Dev stub auth exposes first user to any origin** — No token inspection in `resolveStubAuth`.                                                    | `apps/api/src/plugins/auth.ts`         | S      | Integration |
| 20  | **Missing focus rings on MagneticButton and TabsTrigger** — Keyboard users cannot see focus.                                                      | `MagneticButton.tsx`, `Tabs.tsx`       | S      | Frontend    |
| 21  | **NewCompanyDialog uses raw `<input>` elements** — Missing aria, error linkage, loading state.                                                    | `CompaniesPage.tsx`                    | S      | Frontend    |
| 22  | **Inline-edit cells have no loading or error state** — Users only get a toast on failure.                                                         | `OpportunitiesPage.tsx`                | M      | Frontend    |
| 23  | **Hardcoded hex/rgba colors break theming** — `Button.tsx`, `Avatar.tsx`, `SavedFlash.tsx`, `Toast.tsx`, `Table.tsx`, `LoginPage.tsx`             | 6+ files                               | M      | Frontend    |
| 24  | **Bulk actions not disabled during mutation** — Users can trigger duplicate requests.                                                             | `OpportunitiesPage.tsx`                | S      | Frontend    |
| 25  | **Missing DB indexes on 9 high-cardinality columns** — Full table scans on Zapier, Company, Contact, Lead, Invoice, SalesOrder, IntegrationToken. | `schema.prisma`                        | S      | Backend     |

---

## 🟡 P2 — Medium Impact (Polish / Accessibility / Patterns)

| #   | Issue                                                                                                               | File(s)                             | Effort | Source      |
| --- | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------- | ------ | ----------- |
| 26  | **Zapier app lookup by `apiKeyHash` with no index** + no `deletedAt: null` check.                                   | `apps/api/src/routes/zapier.ts`     | S      | Backend     |
| 27  | **Zapier polling returns deleted records** — Missing `deletedAt: null`.                                             | `apps/api/src/routes/zapier.ts`     | XS     | Backend     |
| 28  | **public-nps `parseInt` accepts malformed strings** — `"10abc"` → `10`.                                             | `public-nps.ts`                     | XS     | Backend     |
| 29  | **Users route no pagination** — `take: 1000` hard cap.                                                              | `apps/api/src/routes/users.ts`      | S      | Backend     |
| 30  | **Task update misses dashboard invalidation** — `['crm-dashboard']` not invalidated.                                | `useTasks.ts`                       | XS     | Integration |
| 31  | **Opportunity create inline in component** — Not a reusable hook; breaks project convention.                        | `CreateOpportunityDialog.tsx`       | S      | Integration |
| 32  | **LazyClerkBranch no ErrorBoundary** — CDN chunk failure = auth subtree crash.                                      | `apps/web/src/lib/auth.tsx`         | S      | Integration |
| 33  | **Sales order transition misses report invalidation** — `['sales:monthly']`, `['report:sales-intelligence']` stale. | `useSalesOrders.ts`                 | XS     | Integration |
| 34  | **ContactContextMenu ignores `useReducedMotion`** — Forces scale animation.                                         | `ContactsPage.tsx`                  | S      | Frontend    |
| 35  | **ChartContainer no Escape key dismiss** — Keyboard trap in actions dropdown.                                       | `ChartContainer.tsx`                | M      | Frontend    |
| 36  | **CompanyDetailPage hardcoded `CAD` currency** — Should use `useFormatMoney`.                                       | `CompanyDetailPage.tsx`             | S      | Frontend    |
| 37  | **Accounts/Leads pages use raw HTML inputs** — Missing accessible primitives.                                       | `AccountsPage.tsx`, `LeadsPage.tsx` | S      | Frontend    |
| 38  | **Opportunities KPI grid lacks `aria-label`**                                                                       | `OpportunitiesPage.tsx`             | S      | Frontend    |
| 39  | **TableScrollArea lacks `role="region"` and `aria-label`**                                                          | `Table.tsx`                         | S      | Frontend    |
| 40  | **Array index used as React `key`** — `AuditLogPage.tsx`, `AnalyticsDashboardPage.tsx`                              | 2 files                             | S      | Frontend    |

---

## 🟢 P3 — Cleanup / Nice-to-Have

| #   | Issue                                                                             | File(s)                              | Effort | Source      |
| --- | --------------------------------------------------------------------------------- | ------------------------------------ | ------ | ----------- |
| 41  | **Invoice helpers duplicated between route and service**                          | `invoices.ts`, `invoices.service.ts` | S      | Backend     |
| 42  | **Redundant token length check in public-nps** — Zod already enforces min/max.    | `public-nps.ts`                      | XS     | Backend     |
| 43  | **twenty-bidstack completely orphaned** — Excluded from workspace, deps missing.  | `packages/twenty-bidstack/`          | —      | Integration |
| 44  | **No toast on optimistic rollback** — UI silently snaps back.                     | `useOpportunities.ts`                | S      | Integration |
| 45  | **Button `whileHover` triggers layout recalc** — Use `translateY` instead of `y`. | `Button.tsx`                         | S      | Frontend    |
| 46  | **CompanyDetail uses raw `<table>`** — Should use `Table` primitive.              | `CompanyDetailPage.tsx`              | S      | Frontend    |
| 47  | **Opportunities stage chips use template strings** — Should use `cn()` utility.   | `OpportunitiesPage.tsx`              | XS     | Frontend    |

---

## 🏆 Top 10 Recommendations (Impact ÷ Effort)

| Rank | Fix                                                    | Why                                                      | Effort |
| :--: | ------------------------------------------------------ | -------------------------------------------------------- | :----: |
|  1   | **Catch fire-and-forget promises** (P0 #1)             | Prevents API process crashes from network hiccups        |   S    |
|  2   | **Fix logout cache poisoning** (P0 #2)                 | Stops cross-tenant data leakage on shared machines       |   S    |
|  3   | **Wire backend streaming exports** (P0 #3)             | Users currently export ≤50 rows thinking it's everything |   S    |
|  4   | **Add `deletedAt: null` to opportunity count** (P0 #6) | 1-line fix, stops skewed KPIs                            |   XS   |
|  5   | **Fix silent owner-update failure** (P0 #4)            | Stops silent no-ops on invalid payloads                  |   S    |
|  6   | **Cap contact-import concurrency** (P1 #7)             | Prevents browser tab lock-up during bulk paste           |   S    |
|  7   | **Close invalidation gaps** (P1 #8–10)                 | AR aging, dashboards, KPIs stay stale after mutations    |  XS–S  |
|  8   | **Add missing DB indexes** (P1 #25)                    | Removes full-table scans on hot query paths              |   S    |
|  9   | **Add focus rings to MagneticButton/Tabs** (P1 #20)    | WCAG 2.2 compliance, 1-line each                         |   S    |
|  10  | **Disable bulk actions during mutation** (P1 #24)      | Prevents duplicate requests                              |   S    |

---

## Quick Wins (< 5 min each — 14 items)

1. `opportunities.ts` — Add `deletedAt: null` to count query
2. `zapier.ts` — Add `deletedAt: null` to polling triggers
3. `useInvoices.ts` — Invalidate `['invoices','ar-aging']` on payment
4. `CreateOpportunityDialog.tsx` — Invalidate `['opportunities','count']` on create
5. `useTasks.ts` — Invalidate `['crm-dashboard']` on task update
6. `useLeads.ts` — Invalidate `['opportunityCount']` + `['pipeline-report']` on convert
7. `ContactCsvImportDialog.tsx` — Change `Promise.all` to `for...of` sequential
8. `MagneticButton.tsx` — Append focus-visible ring classes
9. `Tabs.tsx` — Append focus-visible ring to `TabsTrigger`
10. `SavedFlash.tsx` — Change `text-white` to theme token
11. `Toast.tsx` — Change icon circle `text-white` to theme token
12. `OpportunitiesPage.tsx` — Add `disabled={stageMove.isPending}` to bulk select
13. `ChartContainer.tsx` — Add `Escape` key handler to close menu
14. `public-nps.ts` — Remove redundant token length check

---

## Integration Wiring Verdict

| Integration        | Status             | Notes                                         |
| ------------------ | ------------------ | --------------------------------------------- |
| Dust workspace API | ✅ Wired & active  | Bidirectional sync with 5-min conflict window |
| MCP server         | ✅ Wired, ⚠️ leaky | 14+ tools exposed; unbounded session Maps     |
| Twenty overlay     | ❌ Orphaned        | Excluded from workspace, deps missing         |
| BullMQ workers     | ✅ Wired           | 4 queues active                               |
| Clerk auth         | ✅ Wired (prod)    | Dev stub has security gap on network exposure |
