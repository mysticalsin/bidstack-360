# URL parameter audit — pre-flight for `nuqs`

**Status:** complete · **Date:** 2026-08-03 · **Phase:** Round 2, Phase 0
**Trigger:** ROUND2-ULTRAPLAN.md Phase 0 commit 5 — `feat(web): add nuqs + NuqsAdapter (react-router v6)`
is gated on "a written `?tab=`/`?view=` audit of the four surfaces" and on
"nuqs writers must preserve unrelated params" (risk row 6).

This document is the gate artifact. It enumerates every query parameter read or
written anywhere in `apps/web/src`, states who owns it, and says whether `nuqs`
would collide with it. Line numbers are from `feat/crm-design-fusion` at the time
of writing.

---

## 1. Verdict

**Mounting `NuqsAdapter` is inert.** It is a context provider; it registers no
params, reads nothing, and writes nothing until a component calls `useQueryState`.
Nothing in this audit blocks the mount.

**The four Round-2 target surfaces are close to a clean slate.** Two of them
(`ComplianceMatrix`, `ReferencesPage`) use *zero* query params today. The other
two own two params each, and neither shares a param name with anything else on
its route.

**The real hazard is the inverse of the one the plan anticipated.** The plan
worried nuqs would stomp existing params. In fact **nuqs merges and the existing
code replaces**: five call sites already call `setSearchParams({...})` with an
object literal, which discards the entire query string, including params owned by
sibling components. Three of those five are on Round-2 target surfaces. Converting
those pages to nuqs makes them *safer*, not riskier — but any page that keeps a
raw object-form writer **next to** a nuqs writer will silently drop the nuqs key.
See §4.

---

## 2. The four Round-2 target surfaces

| Surface | File | Param | Type | Read | Written | nuqs collision |
|---|---|---|---|---|---|---|
| Proposals | `src/pages/ProposalsPage.tsx` | `status` | `ProposalStatus` enum, absent = "all" | `:52` | `:154` `setSearchParams({})`, `:155` `setSearchParams({ status: s })` — **object form, destructive, push** | **None on the name.** Conversion must replace both writers together, or the destructive `setSearchParams({})` at `:154` will also clear `new`. |
| Proposals | `src/pages/ProposalsPage.tsx` | `new` | `'1'` flag; deep-link from the RFP Response Hub "New Proposal" shortcut | `:55` — read **once** to seed `useState`, never re-read | never written; never cleared | **Latent bug, pre-existing.** Because it is never cleared, `?new=1` stays in the URL after the dialog closes. A nuqs writer on the same page will preserve it (merge), so the stale param survives a status-filter click where today it is wiped. Decide at conversion: either model `new` as a nuqs param and clear it on close, or delete the param after first read. |
| Bid / No-Bid | `src/pages/BidNoBidPage.tsx` | `opportunityId` | opaque cuid string; absent = no opportunity selected | `:34` | `:230` `setSearchParams({ opportunityId: id })`, `:232` `setSearchParams({})` — **object form, destructive, push** | **None on the name.** Same conversion note as above: both writers move together. |
| Compliance matrix | `src/components/rfp/compliance/ComplianceMatrix.tsx` (93 lines) | — | — | — | — | **None — the component reads no query params at all.** All state is props/hooks. Its host route `src/pages/RfpPipelinePage.tsx:46` keys off the **path** param `:id` (`useParams`), not the query string. |
| References | `src/pages/ReferencesPage.tsx` | — | — | — | — | **None — zero query params.** `search` (`:42`), `industry` (`:43`), `tag` (`:44`), `showCreate` (`:62`) are all `useState`. This surface is a greenfield nuqs target: converting it *adds* URL state where there is none, so there is nothing to collide with. |

> **Plan correction.** ROUND2-ULTRAPLAN.md §"URL-as-state" implies all four
> surfaces carry query state that nuqs must be careful around. Two of them carry
> none. Read the table above, not the plan, when scoping the conversion.

---

## 3. The Settings `?tab=` pattern

`tab` is the single most widely *linked* param in the app and the only one read by
components outside the page that owns it.

| Role | File | Line | Behaviour |
|---|---|---|---|
| Owner (read) | `src/pages/SettingsPage.tsx` | `:79` | `searchParams.get('tab')`, normalised through `resolveSettingsTab(requestedTab, isAdmin)` — an unknown or unauthorised tab is rewritten to `overview`. |
| Owner (write) | `src/pages/SettingsPage.tsx` | `:84` | `setSearchParams({ tab: activeTab }, { replace: true })` in an effect — canonicalises an invalid tab. **Object form, destructive.** |
| Owner (write) | `src/pages/SettingsPage.tsx` | `:89` | `setSearchParams({ tab })` on tab click. **Object form, destructive, push.** |
| **Foreign reader** | `src/components/layout/Sidebar.tsx` | `:314-316` | Parses `tab` out of each nav item's `to` and out of `location.search`, and derives the nav item's active state from the comparison. Treats a missing `tab` as `overview`. **Read-only — never writes.** |
| **Foreign reader** | `src/components/layout/MobileNav.tsx` | `:201-203` | Identical logic to Sidebar. **Read-only — never writes.** |
| Link producers | ~20 sites | — | `/settings?tab=…` hardcoded in `SettingsLayout.tsx:178`, `SerumGlass.tsx:128`, `SerumControlPlaneSection.tsx:163,201,438,476,496`, `AuditLogPage.tsx:4` and `IntegrationsPage.tsx:4` (both `<Navigate replace>`), `QuickStartPage.tsx:49,113`, and six `EmptyStateLink` call sites. |

**nuqs collision on `tab`: none, with one condition.**
Sidebar and MobileNav only *read*, and they read from `location.search` directly
rather than through react-router's `useSearchParams`. A nuqs writer on `tab`
updates the real URL, so `location` still updates and both stay correct. The
condition: **if `tab` is ever converted to nuqs, it must use
`history: 'push'`** (nuqs defaults to `replace`) to preserve today's behaviour at
`SettingsPage.tsx:89`, where clicking a tab pushes a history entry and Back walks
tabs. `:84`'s canonicalisation is the one place that must stay `replace`.

Settings is **not** a Round-2 target surface. No change is proposed here; this
section exists because the plan named the pattern as a collision risk and because
`tab` is the only param with cross-component readers.

---

## 4. Full app-wide parameter inventory

Every query param read or written in `apps/web/src`, grouped by route owner.
"Write style" is the load-bearing column:

- **merge** — `new URLSearchParams(searchParams)` then `.set`/`.delete`. Preserves
  unrelated params. Compatible with nuqs.
- **functional** — `setSearchParams(prev => …)`. Same, and additionally safe under
  concurrent updates.
- **object** — `setSearchParams({ … })`. **Discards every param not in the
  literal.** Incompatible with a nuqs writer on the same route.

| Route / component | File:line | Param | Type | Write style |
|---|---|---|---|---|
| Accounts | `pages/AccountsPage.tsx:25,28` | `view` | segment enum; `all` omitted | **functional**, push |
| Companies | `pages/CompaniesPage.tsx:41,83,88,265,291,384` | `search`, `sort` | string; sort spec | **merge**, replace |
| Contacts | `pages/ContactsPage.tsx:44,88,106,93,120` | `sort` | sort spec | **merge**, replace |
| Leads | `pages/LeadsPage.tsx:97,118,102,136` | `sort` | sort spec | **merge**, replace |
| Opportunities | `pages/OpportunitiesPage.tsx:51,58,69,145,64,76,150,294` | `search`, `pipelineStageId`, `due`, `sort` | string; cuid; `within7\|overdue`; sort spec | **merge**, replace (`:294` push) |
| Pipeline | `pages/PipelinePage.tsx:55,60` | `pipelineStageId` | cuid | **merge**, replace |
| Pipeline view switch | `components/opportunity/PipelineViewSwitch.tsx:20` | `pipelineStageId` | cuid | **read-only** (forwards it into a `navigate`) |
| Tasks | `pages/TasksPage.tsx:56,103,157,162,169,179` | `filter`, `sort`, `view` | status enum (`all` omitted); `Sort` (`natural` omitted); `list\|calendar` (`list` omitted) | **merge**, replace |
| Search | `pages/SearchPage.tsx:36,37,80,84` | `q`, `type` | string; `TabKey` | **object**, push ⚠ |
| Intake | `pages/IntakePage.tsx:27` | `account` | cuid | **read-only** |
| Analytics dashboard | `pages/AnalyticsDashboardPage.tsx:32` | `id` | dashboard id; seeds `useState`, never re-read | **read-only** |
| Audit log (Settings section) | `components/settings/AuditLogSection.tsx:29,30,31,32,70,73` | `q`, `range`, `target`, `category` | string; date range; target enum; quick-filter enum | **merge**, replace — except `:73` `clearFilters`, which calls `setSearchParams(new URLSearchParams())` and **wipes every param on the route, including `tab`** ⚠ |
| Settings | `pages/SettingsPage.tsx:79,84,89` | `tab` | `SettingsSection` | **object** ⚠ (see §3) |
| Proposals | `pages/ProposalsPage.tsx:52,55,154,155` | `status`, `new` | enum; `'1'` flag | **object**, push ⚠ |
| Bid / No-Bid | `pages/BidNoBidPage.tsx:34,230,232` | `opportunityId` | cuid | **object**, push ⚠ |
| Web Vitals HUD (dev) | `components/dev/WebVitalsHud.tsx:16` | `devhud` | `'1'` flag | **read-only**, and read from `window.location.search` — outside react-router entirely, so outside nuqs entirely |

**No two components on the same route own the same param name.** `sort` appears on
five routes, `view` on two, `pipelineStageId` on two — always on disjoint routes.
There is no name to reserve or rename before nuqs lands.

### The five destructive writers (⚠ above)

`SearchPage.tsx:80,84` · `SettingsPage.tsx:84,89` · `ProposalsPage.tsx:154,155` ·
`BidNoBidPage.tsx:230,232` · `AuditLogSection.tsx:73`

Each already destroys unrelated params today. Two of them are visibly load-bearing:

- `AuditLogSection.tsx:73` "clear filters" runs inside the Settings page and wipes
  `tab` along with the four audit filters — the URL degrades to bare `/settings`
  while the audit-log tab is still rendered, and Sidebar's active-state check
  (§3) then reports `overview` as active.
- `ProposalsPage.tsx:154` clears `new` as a side effect of clearing `status`.

**Rule for conversion:** a route may not mix a nuqs writer with a raw object-form
`setSearchParams`. When a surface is converted, every writer on that route
converts in the same commit, or the survivors are first rewritten to merge form.

---

## 5. Adjacent consumer: `SavedViewsBar`

`src/components/ui/SavedViewsBar.tsx` persists named filter presets and, for
URL-state pages (Tasks, Opportunities, Companies), captures the preset as the raw
`location.search` string and restores it with `navigate(basePath + query)`.

Two consequences for nuqs:

1. **Restore works unchanged.** nuqs reads the URL through the adapter's
   `useSearchParams`, so a `navigate()` that rewrites the query string is picked
   up like any other navigation.
2. **Saved views are stored in localStorage and outlive a rename.** If a
   conversion changes a param's name or serialisation, previously saved views on
   that surface silently restore the wrong state. None of the three URL-state
   surfaces it serves is a Round-2 target, so this is a note for later phases, not
   a Phase 0 action.

---

## 6. nuqs configuration required by this audit

When surfaces are converted (Phase 1+, **not** this phase):

| Setting | Value | Why |
|---|---|---|
| `history` | `'replace'` for filters and sorts; `'push'` for pagination and for `tab` if it is ever converted | Matches today's behaviour: every merge-form filter writer in §4 already passes `{ replace: true }`; `SettingsPage.tsx:89` and `AccountsPage.tsx:28` push. |
| `clearOnDefault` | `true` (the nuqs 2.x default) | Matches the existing convention of omitting the default value — `TasksPage.tsx:159` drops `view=list`, `:174` drops `filter=all`, `AccountsPage.tsx:31` drops `view=all`. |
| `shallow` | `true` (default) | No SSR loader in this SPA; there is nothing to notify server-side. |
| Param merging | leave at default | nuqs writes only the keys it owns and merges the rest. This is the behaviour the plan asked for; it needs no configuration, only the §4 rule that raw object-form writers must not survive on a converted route. |

---

## 7. Phase 0 conclusion

- `NuqsAdapter` mounts inside `<BrowserRouter>` in `src/main.tsx`. It must be
  inside the router: `nuqs/adapters/react-router/v6` calls react-router's
  `useNavigate` and `useSearchParams` (verified in
  `node_modules/nuqs/dist/adapters/react-router/v6.js`).
- **No page is converted in this phase.** No param changes name, type, or write
  style.
- Follow-up owned by later phases, recorded here so it is not rediscovered:
  the five destructive writers in §4, the never-cleared `?new=1` on
  `ProposalsPage`, and `AuditLogSection.tsx:73` clearing `tab`.
