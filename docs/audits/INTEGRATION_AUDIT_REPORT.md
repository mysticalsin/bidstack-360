# BidStack 360° — Full-Stack Integration Audit Report

**Auditor:** Kimi Code CLI (sub-agent)  
**Date:** 2026-05-23  
**Scope:** `apps/web/`, `apps/api/`, `apps/worker/`, `apps/mcp-server/`, `packages/dust-client/`, `packages/twenty-bidstack/`  
**Method:** Static code analysis of user flows, React Query patterns, integration wiring, and data-consistency guarantees.

---

## Findings Table

| Severity | Category                | File                                                                                  | Description                                                                                                                                                                                                                                                                                                                  | Effort |
| -------- | ----------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| **P0**   | Auth / Security         | `apps/web/src/lib/auth.tsx` + `apps/web/src/lib/queryCache.ts`                        | `watchAuthForCacheClear` looks for `bidstack:session` in `localStorage`, but **nothing ever sets this key**. Result: React Query cache (containing opportunities, invoices, contacts) **persists in `localStorage` after logout**. Next user on the same machine sees the previous tenant's data until a hard refresh.       | S      |
| **P0**   | Data Export             | `apps/web/src/pages/InvoicesPage.tsx`, `OpportunitiesPage.tsx`, `SalesOrdersPage.tsx` | Frontend "Export CSV" buttons only export the **current paginated page** (≤50 rows). The backend has built **streaming cursor-paginated export endpoints** (`/api/invoices/export`, `/api/opportunities/export`) that can handle 10k+ rows, but the frontend never calls them. Users believe they exported the full dataset. | S      |
| **P1**   | Data Import             | `apps/web/src/components/contact/ContactCsvImportDialog.tsx`                          | Pasting a large CSV fires `Promise.all(importable.map(...create.mutateAsync(...)))`. A 200-row paste = **200 concurrent POST /api/contacts requests** + 200 cache invalidations. No batch endpoint exists for contacts.                                                                                                      | S      |
| **P1**   | Data Consistency        | `apps/web/src/hooks/useInvoices.ts`                                                   | `useRecordPayment` and `useTransitionInvoice('pay')` update the invoice detail cache but **never invalidate `['ar-aging']`**. The AR Aging report remains stale after a payment is recorded.                                                                                                                                 | XS     |
| **P1**   | Data Consistency        | `apps/web/src/components/opportunity/CreateOpportunityDialog.tsx`                     | On success it invalidates `['opportunities']` and `['report:pipeline']`, but **misses `['opportunityCount']`**, `['crm-dashboard']`, `['forecasts']`, and `['goals']`. KPI badges and dashboards show stale counts.                                                                                                          | XS     |
| **P1**   | Data Consistency        | `apps/web/src/hooks/useLeads.ts`                                                      | `useConvertLead` invalidates leads and opportunities lists, but **misses `['opportunityCount']`**, `['crm-dashboard']`, and `['pipeline-report']\*\*. A converted lead does not immediately appear in pipeline KPIs.                                                                                                         | XS     |
| **P1**   | Auth / Security         | `apps/api/src/plugins/auth.ts`                                                        | Dev stub auth (`resolveStubAuth`) returns the first seeded user **without inspecting any token or cookie**. If the dev API is exposed to the network (e.g., testing on a phone), any request from any origin is authenticated as admin.                                                                                      | S      |
| **P1**   | Infra / Memory          | `apps/mcp-server/src/server.ts`                                                       | `streamableTransports` and `sseTransports` Maps grow **unbounded**. If MCP clients disconnect uncleanly (network drop, browser close), sessions leak forever. No TTL, max-size cap, or periodic sweep.                                                                                                                       | S      |
| **P1**   | Integration Reliability | `apps/api/src/lib/dust-push.ts`                                                       | `pushOpportunityToDust` and `pushLeadToDust` are fire-and-forget with **zero retry**. If Dust is temporarily down or returns 5xx during a mutation, that record is never re-synced.                                                                                                                                          | M      |
| **P2**   | Integration Wiring      | `packages/twenty-bidstack/`                                                           | **Completely orphaned**. Excluded from `pnpm-workspace.yaml` (`!packages/twenty-bidstack`). Its dependencies (`twenty-shared`, `twenty-server`, `twenty-front`) do not exist in this monorepo. It cannot build or run. It is a future-migration artifact, not a live integration.                                            | —      |
| **P2**   | Data Consistency        | `apps/web/src/hooks/useTasks.ts`                                                      | `useUpdateTask` invalidates `['tasks']`, `['tasks', 'summary']`, and `['opportunity']`, but **misses `['crm-dashboard']`**. Task completion does not refresh dashboard widgets.                                                                                                                                              | XS     |
| **P2**   | Code Patterns           | `apps/web/src/components/opportunity/CreateOpportunityDialog.tsx`                     | The opportunity-create mutation is **inline inside a UI component**, not a reusable hook. Every other entity (leads, contacts, tasks, invoices) has a `useCreateXxx` hook in `apps/web/src/hooks/`. This breaks the project's own convention and prevents non-dialog pages from creating opportunities.                      | S      |
| **P2**   | Error Handling          | `apps/web/src/lib/auth.tsx`                                                           | `LazyClerkBranch` is wrapped in `Suspense` with a fallback that renders a loading context, but there is **no ErrorBoundary** around the lazy Clerk chunk. If the Clerk CDN chunk fails to load, the entire auth subtree crashes with no recovery UI.                                                                         | S      |
| **P3**   | Data Consistency        | `apps/web/src/hooks/useLeads.ts`                                                      | `useCreateLead` only invalidates `['leads']`; it does not invalidate `['opportunities']`, `['contacts']`, or `['crm-dashboard']` even though a new lead may affect pipeline counts and account intel.                                                                                                                        | XS     |
| **P3**   | Data Consistency        | `apps/web/src/hooks/useSalesOrders.ts`                                                | `useCreateSalesOrder` seeds the detail cache and invalidates KPIs, but `useTransitionSalesOrder` only invalidates list + detail. It does **not** invalidate `['sales:monthly']` or `['report:sales-intelligence']`, so reports stay stale after state transitions.                                                           | XS     |
| **P3**   | Polish                  | `apps/web/src/hooks/useOpportunities.ts`                                              | `usePatchOpportunity` and `useStageMutation` correctly roll back optimistic updates on error, but they do not **show a toast or other user feedback** when rollback occurs. The UI silently snaps back, which can confuse users on slow networks.                                                                            | S      |

---

## Top 5 Recommendations (Impact ÷ Effort)

### 1. Fix logout cache poisoning — `queryCache.ts` + `auth.tsx` (P0, Effort: S)

Set and clear `bidstack:session` in both auth modes so `watchAuthForCacheClear` actually fires on logout. This prevents cross-tenant data leakage on shared machines.

### 2. Wire backend streaming exports into the frontend (P0, Effort: S)

Replace the client-side `rowsToCsv` calls in `InvoicesPage`, `OpportunitiesPage`, and `SalesOrdersPage` with `window.location.href = '/api/.../export?...'` (or a hidden `<a download>`). The backend already streams UTF-8 CSV with BOM and formula-injection sanitization.

### 3. Cap contact-import concurrency (P1, Effort: S)

Replace `Promise.all(...)` in `ContactCsvImportDialog` with a sequential `for...of` loop or a concurrency limit of 3–5. This prevents browser tab and API lock-up during bulk paste operations. Consider adding a bulk-create endpoint (`POST /api/contacts/bulk`) for a proper fix.

### 4. Close the invalidation gaps (P1, Effort: S–M)

Audit every mutation `onSuccess`/`onSettled` against the query-key registry and add missing invalidations. The highest-impact gaps are:

- Invoice pay/record → invalidate `['ar-aging']`
- Opportunity create/convert/stage → invalidate `['opportunityCount']`, `['crm-dashboard']`, `['pipeline-report']`
- Task update → invalidate `['crm-dashboard']`
- Lead convert → invalidate `['opportunityCount']`, `['crm-dashboard']`

### 5. Add session eviction to the MCP server (P1, Effort: S)

Give the `streamableTransports` and `sseTransports` Maps a TTL sweep (e.g., `setInterval` every 60s deleting entries older than 30m) or use a library like `mnemonist/LRUMap` with a max size. This prevents memory exhaustion under unclean client disconnects.

---

## Quick Wins (< 5 min each)

| #   | Fix                                                                                                                                                                          | File(s)                                                           |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| 1   | **Clear cache on logout.** Set `localStorage.setItem('bidstack:session','1')` on sign-in and `removeItem` on sign-out in both `StubAuthProvider` and `ClerkAuthBridge`.      | `apps/web/src/lib/auth.tsx`                                       |
| 2   | **Invalidate AR aging on payment.** Add `void qc.invalidateQueries({ queryKey: ['invoices','ar-aging'] })` to `useRecordPayment` and `useTransitionInvoice` `onSuccess`.     | `apps/web/src/hooks/useInvoices.ts`                               |
| 3   | **Invalidate opportunity count on create.** Add `qc.invalidateQueries({ queryKey: ['opportunities','count'] })` to `CreateOpportunityDialog` `onSuccess`.                    | `apps/web/src/components/opportunity/CreateOpportunityDialog.tsx` |
| 4   | **Cap contact-import concurrency.** Change `Promise.all(importable.map(...))` to a `for...of` with `await` so rows import sequentially.                                      | `apps/web/src/components/contact/ContactCsvImportDialog.tsx`      |
| 5   | **Invalidate dashboard on task change.** Add `void qc.invalidateQueries({ queryKey: ['crm-dashboard'] })` to `useUpdateTask` `onSettled`.                                    | `apps/web/src/hooks/useTasks.ts`                                  |
| 6   | **Invalidate pipeline KPIs on lead convert.** Add `void qc.invalidateQueries({ queryKey: ['opportunityCount'] })` and `['pipeline-report']` to `useConvertLead` `onSuccess`. | `apps/web/src/hooks/useLeads.ts`                                  |

---

## Integration Wiring Verdict

| Integration            | Status             | Notes                                                                                                                                                                                                                                     |
| ---------------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Dust workspace API** | ✅ Wired & active  | `packages/dust-client/` is imported by `apps/api/src/lib/dust-push.ts` and `apps/worker/src/queues/dust-poll.ts`. Bidirectional sync (CRM → Dust on mutation, Dust → CRM via worker poll) is implemented with a 5-minute conflict window. |
| **MCP server**         | ✅ Wired, ⚠️ leaky | `apps/mcp-server/` is a standalone Fastify app (`pnpm dev:mcp`). It exposes 14+ tools over Streamable HTTP + legacy SSE. Auth is API-key based with per-minute + per-hour rate limits. **Risk:** unbounded session Maps.                  |
| **Twenty overlay**     | ❌ Orphaned        | `packages/twenty-bidstack/` is excluded from the pnpm workspace. It depends on `twenty-shared`, `twenty-server`, etc., which do not exist in this repo. It is a **future migration artifact**, not a running integration.                 |
| **BullMQ workers**     | ✅ Wired           | `apps/worker/` consumes `dust-poll`, `webhook-delivery`, `company-enrich`, and `document-extract` queues. Producers are in `apps/api/src/queues/`.                                                                                        |
| **Clerk auth**         | ✅ Wired (prod)    | Lazy-loaded Clerk chunk in `apps/web/src/lib/auth.tsx`. Dev stub bypasses external auth.                                                                                                                                                  |

---

## Auth Flow Trace

1. **Login** (`/login`) → `LoginPage` checks `VITE_CLERK_PUBLISHABLE_KEY`.
   - **Stub mode** (no key): "Skip to Dashboard" button calls `navigate('/dashboard')`.
   - **Clerk mode**: SSO buttons trigger Clerk's `AuthenticateWithRedirectCallback` on `/sso-callback`.
2. **Session** → `AuthProvider` mounts either `StubAuthProvider` or `LazyClerkBranch`.
   - Stub: hardcodes user `stub-user-1` / role `admin`.
   - Clerk: fetches JWT, maps `org:admin` → `admin`, sets `setApiTokenProvider(() => auth.getToken())`.
3. **API calls** → `api()` in `apps/web/src/lib/api.ts` injects `Authorization: Bearer <token>` (Clerk) or omits it (stub). Backend `auth.ts` plugin resolves context.
4. **Logout** → `useSignOut()` calls `clerk.signOut()` or flips stub state. **Bug:** `queryCache.ts` expects `bidstack:session` in `localStorage` to detect logout, but **nothing writes this key**, so the React Query cache is **never cleared**.

---

## Data Consistency Scorecard

| Trigger                  | Lists refreshed?                    | Detail refreshed?            | Dashboards / KPIs refreshed?                                                      | Grade |
| ------------------------ | ----------------------------------- | ---------------------------- | --------------------------------------------------------------------------------- | ----- |
| Opportunity patched      | ✅ `['opportunities']`              | ✅ `['opportunity',id]`      | ⚠️ Only `['pipeline-report']`; misses `['crm-dashboard']`, `['opportunityCount']` | B     |
| Opportunity stage moved  | ✅ `['opportunities']`              | ✅ `['opportunity',id]`      | ⚠️ Only `['report:pipeline']`                                                     | B     |
| Opportunity created      | ✅ `['opportunities']`              | ❌ N/A                       | ❌ Misses `['opportunityCount']`, `['crm-dashboard']`, `['forecasts']`            | C     |
| Lead converted           | ✅ `['leads']`, `['opportunities']` | ✅ `['leads',id]`            | ❌ Misses `['opportunityCount']`, `['crm-dashboard']`, `['pipeline-report']`      | C     |
| Task updated             | ✅ `['tasks']`                      | ❌ No detail cache for tasks | ⚠️ Only `['tasks','summary']`, `['opportunity']`                                  | B     |
| Invoice paid             | ✅ `['invoices']`                   | ✅ `['invoice',id]`          | ❌ `['ar-aging']` stale                                                           | D     |
| Sales order transitioned | ✅ `['sales:orders']`               | ✅ `['sales:order',id]`      | ✅ KPIs invalidated                                                               | A     |
