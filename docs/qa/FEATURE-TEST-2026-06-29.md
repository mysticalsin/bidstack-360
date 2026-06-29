# BidStack 360° — Live Feature Test (2026-06-29)

**Tester:** automated browser walk (chrome-devtools-mcp) · **Target:** deployed demo
`https://bidstack-demo.vercel.app` (passwordless demo mode, fresh throwaway org `qa.fulltest@example.com`, ADMIN).
**Scope:** every nav-reachable route (~64) + detail pages + a full create write-flow + console/error sweep.

> ⚠️ **This tested the DEPLOYED demo, not the local `feat/prod-hardening-mantu` branch** (Docker engine
> wouldn't start locally, so the live demo was used). The deployed build may lag the branch — re-verify the
> findings below against current code before fixing.

---

## Verdict: **the app works.** ~60 features load and function; **1 real broken nav link**, 3 minor issues.

Dashboard loaded full ($6.2M pipeline, funnel, top accounts, recent activity, win rate), all CRM lists are
rich and interactive, detail pages load, and **create-lead persists end-to-end**. The failures are narrow.

---

## 🔴 / 🟠 Issues found

### 1. "Custom Objects" sidebar nav link → 404  (Medium — user-facing)
Clicking **Custom Objects** in the sidebar goes to `/custom-objects`, which renders **"404 — Custom object
'' not found"**. Same for `/custom-objects/new` → **"Object not found"**. Root cause: `/custom-objects` and
`/custom-objects/new` are dynamic object-key routes that treat the bare path / `new` as a record key to look
up. The **working** management UI is `/settings/custom-objects` and `/admin/custom-objects` (both load fine).
**Fix:** point the nav link (and the "new" entry) at `/settings/custom-objects`, or make `/custom-objects`
render the object list instead of a key lookup.

### 2. Repeated background `401` in console  (Minor — investigate)
On the Leads page, console shows `Failed to load resource: 401 (×5)`. Some endpoint/poll is being called
without valid auth (likely a stale-session retry or an under-authed background fetch — possibly the stale
RECENT account below). Pages still render; worth tracing the offending request.

### 3. Stale "RECENT" sidebar entries persist across demo sessions  (Minor — demo-specific)
The sidebar **RECENT** list showed a duplicate **"Sanofi"** pointing at an old org's account id
(`32cc6e00…`) from the *expired* session; clicking it gives "Account not found" (the id belongs to a
different org). RECENT is held in localStorage and isn't cleared when a new demo org is provisioned.

### 4. Missing `<h1>` on `/calendar` and `/workspace`  (Minor — a11y)
Both render content but have no top-level `<h1>` heading (the rest of the app has one). WCAG/landmark gap.

---

## ✅ Verified working (route-level load + no error)

**Core CRM:** dashboard, leads (list + detail "Aisha Rahman"), contacts, companies, accounts (list + cockpit
detail, 7k chars), opportunities (list + detail "Data Lakehouse Build"), pipeline, tasks.
**KAM / accounts:** kam, key-accounts ("Strategic Accounts"), top-accounts, sector-view, territories,
cross-sell.
**Bids / RFP:** proposals, admin/rfp ("RFP Analytics"), bid-matrix ("Bid/No-Bid Decision Matrix"), intake,
references.
**Analytics:** analytics, dashboards, reports/list, reports/new, forecasts. (Empty-state — see below.)
**AI / platform:** agent-studio (= /agents), serum ("SERUM Mission Control", rich), sales-toolkits,
admin/predictive ("Predictive Scoring"), settings/custom-objects, admin/custom-objects.
**Activities / workspace:** calendar, calls, service-desk, workspace, quick-start, workflows, search.
**Admin / settings:** settings, roles ("Roles & Permissions"), integrations / webhooks / audit-log (all
correctly redirect to the matching Settings tab and render rich content).

### Write flow (read+write) — PASS
`/leads/new` → filled First/Last/Email/Company → **Create lead** showed a "Creating…" loading state →
redirected to the new `/leads/{id}` detail ("QAWrite TestLead") → leads list count went **5 → 6** with the new
lead present. Full create→persist→list-refresh path works.

### Empty states (correct, not bugs)
analytics ("No dashboards — create your first"), dashboards, reports/list, workflows, service-desk, kam,
cross-sell, references, custom-objects admin — all show proper empty states because the fresh demo org has no
data for them yet.

---

## Coverage / honesty

- **Tested:** every route in the SPA router (~64), 3 detail pages, 1 end-to-end create, console errors on key
  pages. Login/auth (demo passwordless) works including session-expiry handling.
- **Not exhaustively tested:** every in-page action (each filter, edit dialog, drag-drop pipeline reorder, CSV
  export download, every settings sub-action, RFP upload→parse, signature send, KAM handoff export). These
  were spot-checked at the control level (present + wired) but not each driven to completion.
- **Environment caveat:** deployed demo, possibly behind the branch. Re-run against the branch (needs a local
  Postgres — Docker engine was hung this session) to confirm the custom-objects nav bug and the 401 still
  reproduce on current code.
