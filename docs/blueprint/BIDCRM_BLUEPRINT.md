# BidStack 360° — Strategic Blueprint

Source artifact: applies prompts 11–20 of the _Ultimate Apple Design Prompt v2_ library to the BidStack 360° codebase as it stands at 2026-05-11. This is the single source of truth for product direction, scope, and launch posture. Update when scope shifts; do not duplicate elsewhere.

---

## 1. App Blueprint (prompt 11)

### Personas

| Persona                                         | Day-to-day                                    | Top pain                                                             | What BidStack 360° fixes                                                                              |
| ----------------------------------------------- | --------------------------------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| **Bid Manager (primary)** — Mantu presales lead | Owns 5–15 active bids, hands-off to delivery  | "I lose half a day every Monday refreshing data and chasing context" | Cockpit dashboard surfaces every signal in one view; Dust agents auto-brief the bid                   |
| **Account Executive**                           | 30+ named accounts, deep into the pipeline    | "Stage updates rot. The forecast is always a week stale"             | Inline-editable stage/value/probability with optimistic UI; pipeline kanban with drag-and-drop        |
| **CRO / Head of Sales**                         | Owns the number; wants the truth not the spin | "Reports look great but I can't trust them"                          | Audit log on every PATCH; data-quality report (duplicate companies, stale enrichment, missing owners) |
| **Solutions Architect**                         | Pulled into deals for technical credibility   | "I keep getting handed the wrong customer brief"                     | One-click "Ask Dust" briefing per account; opportunity files panel; key-contacts roster               |

### Value proposition

> One cockpit for the entire bid lifecycle: every customer fact, every deal stage, every follow-up — surfaced, attributed, and auditable. Stop bouncing between Twenty, Dust, SAM.gov and Slack.

### MVP / v1 / v2

| Tier    | Feature                                                         | Status     |
| ------- | --------------------------------------------------------------- | ---------- |
| **MVP** | Account cockpit (Stack360-style)                                | ✅ shipped |
| MVP     | Opportunities list + Twenty-style inline edit                   | ✅ shipped |
| MVP     | Contacts CRUD + decision-unit mapping                           | ✅ shipped |
| MVP     | Tasks with optimistic status toggle                             | ✅ shipped |
| MVP     | Pipeline kanban + drag-and-drop                                 | ✅ shipped |
| MVP     | API keys + workspace settings                                   | ✅ shipped |
| MVP     | Audit log                                                       | ✅ shipped |
| **v1**  | Dust bridge (agents + workspace API)                            | ✅ shipped |
| v1      | Apollo / Clearbit enrichment via BullMQ                         | ✅ shipped |
| v1      | MCP server (`crm_*` toolset) + legacy dotted names              | ✅ shipped |
| v1      | Provider health + connectors catalog + data-quality report      | ✅ shipped |
| v1      | Optimistic mutations on every CRUD                              | ✅ shipped |
| v1      | Command palette (search opps/accounts/contacts/tasks + recents) | ✅ shipped |
| v1      | Activity timeline card                                          | ✅ shipped |
| v1      | Web Vitals reporter                                             | ✅ shipped |
| **v2**  | Bulk select + bulk actions (opps, contacts)                     | 🔜         |
| v2      | CSV export (Twenty parity)                                      | 🔜         |
| v2      | Saved views / custom filters per table                          | 🔜         |
| v2      | Mobile-responsive shell + swipe gestures                        | 🔜         |
| v2      | Real-time integration health (SSE)                              | 🔜         |
| v2      | Custom dashboard layouts per role                               | 🔜         |
| v2      | Win/loss analytics + cohort dashboards                          | 🔜         |

### User flow (text diagram)

```
Sign in (Clerk / stub)
  ↓
Dashboard (org-wide cockpit, Mantu default)
  ↓
   ├── ⌘K → Command palette (jump anywhere)
   ├── /accounts → grid → /accounts/:id (cockpit)
   ├── /opportunities → inline-editable table → /opportunities/:id (detail)
   ├── /pipeline → drag kanban (optimistic stage move)
   ├── /contacts → searchable table with optimistic edit/delete
   ├── /tasks → click badge to cycle status, filter chips
   ├── /reports → pipeline funnel + revenue forecast
   ├── /integrations → Dust status / MCP tools / connectors / data quality / provider health
   ├── /audit-log → cursor-paginated diff feed
   └── /settings → workspace, API keys, theme
```

### Monetization model

Internal tool for Mantu (no SaaS pricing v1). If extracted to product:

- **Team tier** — €29/seat/month — full CRM + 1 Dust agent + 1k enrichments/month.
- **Business** — €79/seat/month — unlimited enrichment, all MCP tools, audit log retention 1y.
- **Enterprise** — quote — Clerk SSO, custom Dust agents, data residency choice.

### Risk register

| Risk                                        | Type     | Severity | Mitigation                                                                                   |
| ------------------------------------------- | -------- | -------- | -------------------------------------------------------------------------------------------- |
| Twenty upgrade path drift (overlay package) | Tech     | High     | `packages/twenty-bidstack/` frozen; never hand-edit                                          |
| Dust API rate limits at scale               | Tech     | Medium   | BullMQ workers throttle; backoff in `dust-client`                                            |
| Enrichment provider concentration           | Product  | Medium   | Connectors catalog + provider health card surface alternatives                               |
| GDPR scope (contact data)                   | Legal    | High     | Audit log captures every PATCH/DELETE; per-row org-scoping; right-to-erasure via DELETE      |
| Multi-tenancy bleed-through                 | Security | Critical | Every Prisma query includes `where: { orgId }`; two-step find-then-update on mutating routes |
| Bundle bloat from framer-motion / radix     | Perf     | Low      | manualChunks isolates motion + clerk + radix; visualizer in `--mode analyze`                 |
| Optimistic-cache divergence                 | UX       | Medium   | All optimistic hooks snapshot + rollback on error; `onSettled` invalidates                   |

---

## 2. App Structure (prompt 12)

See [`docs/ARCHITECTURE.md`](../ARCHITECTURE.md) for the authoritative architecture. Summary:

```
apps/
  web/      React 18 + Vite 6 + Tailwind 4 + Zustand + TanStack Query
  api/      Fastify 5 + Zod + Prisma + Pino
  worker/   BullMQ workers (Dust poll, Apollo enrichment)
  mcp-server/  @modelcontextprotocol/sdk — exposes crm_* tools
packages/
  db/       Prisma schema + client
  shared/   Zod schemas, types, queue-config
  dust-client/  Typed Dust workspace API wrapper
  twenty-bidstack/  Twenty overlay (frozen)
```

**Frontend conventions**

- State: Zustand for global UI, React Query for server state. No Redux.
- Forms: controlled with React state; no form library v1 (kept small).
- Motion: `@/lib/motion.ts` provides Apple spring tokens; `@/components/motion/*` exposes `PageTransition`, `Reveal`, `Stagger*`, `AnimatedNumber`.
- Toasts / confirms: `@/components/ui/Toast.tsx` (Zustand stack) and `@/components/ui/ConfirmDialog.tsx` (Promise-returning `confirm()`).

**Backend conventions**

- Routes: `Fastify` + `fastify-type-provider-zod`. Each route declares Zod input/output schemas — the OpenAPI spec is derived automatically.
- Auth: `req.auth.orgId` / `req.auth.userId` are populated by an auth plugin before every route. Stub mode supplies a single seed org for dev.
- Tenancy: every Prisma query touching a tenant table includes `where: { orgId }`. Multi-row updates use two-step find-then-update.

**Analytics taxonomy**

- `crm.<entity>.<action>` (e.g. `crm.company.enrich`, `contact.update`, `opportunity.stage_change`).
- Audit log captures action + targetType + targetId + diff.
- Web Vitals via `@/lib/web-vitals.ts` — `LCP`, `CLS`, `INP`, `FCP`, `TTFB`, rated against Apple-aligned thresholds.

---

## 3. UX Flow (prompt 13)

Style: **Apple HIG meets Twenty CRM** — dense data + Apple typography + spring motion + dark mode.

| Screen               | Goal                                | Main action                                          | UI elements                                                                                                                                        | States                                                            | CTA                                        | Microcopy                                                 | Retention hook                               |
| -------------------- | ----------------------------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------ | --------------------------------------------------------- | -------------------------------------------- |
| `/dashboard`         | Single-glance situational awareness | Pick an account or open command palette              | KPI row, Business Snapshot, Tech Stack, Open Issues, Pipeline by Stage, Recent Opps, Activity Timeline, Live Data Mesh, Notes, Files, Key Contacts | Loading skeleton (shimmer), Empty (no accounts), Error (boundary) | "Enrich now" / "Ask Dust" / open cockpit   | "All clear" / "12 items to action"                        | Recent activity timeline; Dust briefing chip |
| `/accounts`          | Triage accounts by health/pipeline  | Open cockpit on a card                               | Search, industry filter, sort, animated cards with logos                                                                                           | Loading, Empty (filter mismatch), Error                           | "+ New account" (opens opportunity dialog) | "{n} companies · {open} open deals · {pipeline} weighted" | Animated card hover-lift; pipeline glance    |
| `/opportunities`     | Maintain pipeline truth quickly     | Inline-edit stage/value/probability/date             | Twenty-style table, animated rows, click-to-edit cells                                                                                             | Loading, Empty (no opps), Error                                   | "+ New opportunity"                        | "{n} bids in flight · click any cell to edit inline"      | Toast on every save reinforces velocity      |
| `/opportunities/:id` | Deep work on one bid                | Inline-edit + add tasks + ask Dust                   | Header (inline-edit name/customer/industry/stage/value/probability/date), tabs (Overview/Tasks/Files/Notes/Intel)                                  | Loading, Error, Empty per tab                                     | "Ask Dust" / "+ Task"                      | Stage badge animates on change                            | Briefing drawer auto-triggers                |
| `/pipeline`          | Drag the pipeline                   | Drag card between stages                             | Kanban columns, motion drop zones, animated probability meter                                                                                      | Loading, Empty per column ("Drop here")                           | "Updating…" inline pill                    | "in 3d" / "5d late"                                       | Card glides to new column with spring        |
| `/contacts`          | Map the decision unit               | Search + edit/delete                                 | Search input, animated table rows, hover-action group                                                                                              | Loading, Empty (filter / none yet), Error                         | "+ New contact"                            | "{n} people in the decision unit"                         | Sentiment badges color-code engagement       |
| `/tasks`             | Clear the queue                     | Click badge to cycle status                          | Filter chips (All/Overdue/Open/In Progress/Blocked/Done), animated list                                                                            | Loading, Empty per filter, Error                                  | "+ New task"                               | "Marked '{title}' done" toast                             | Strike-through + green badge on done         |
| `/reports`           | Forecast confidence                 | Read                                                 | Funnel chart, revenue projection, win rate                                                                                                         | Loading, Empty                                                    | —                                          | "Weighted pipeline: {amount}"                             | Weekly digest email (v2)                     |
| `/integrations`      | Trust the stack                     | Force resync, copy MCP tool names, revoke connectors | Dust status, provider health (30s poll), connectors catalog, data quality issues, MCP tools, webhook log                                           | Loading, Empty, Error                                             | "Force resync" / "Try again"               | "{n} providers reporting healthy"                         | Live polling badges signal liveness          |
| `/audit-log`         | Forensic trail                      | Cursor-paginate                                      | Diff list with timestamps                                                                                                                          | Loading, Empty (no events match), Error                           | "Load more"                                | "Action {action} on {targetType}"                         | —                                            |
| `/settings`          | Workspace + API keys + theme        | Create / revoke API keys                             | Workspace card, theme cards, API keys card with reveal-once secret                                                                                 | Loading, Empty (no keys), Error                                   | "+ New API key"                            | "Copy your new key now — it won't be shown again."        | Last-used timestamp invites rotation         |

**State patterns**

- _Loading_: shimmer skeleton matching the real layout (row-height, column count).
- _Empty_: glyph drifts on a 3.2s loop; copy is specific (`"Nothing matched \"{query}\""`).
- _Error_: red glyph + try-again button; toast for non-blocking errors.

**Microcopy guidelines**

- Verbs in the user's voice, not the system's: "Save changes", not "Submit". "Delete contact", not "Remove record".
- Numbers are _always_ tabular-nums + locale-formatted.
- Time is relative (`3d ago`) in feeds, absolute (`May 12, 2026`) in detail views.

**Retention hooks**

- Toast on every successful mutation ("Marked done", "Moved to Negotiation") — the page rewards work.
- Optimistic UI everywhere — no spinner gates on a successful action.
- Recent-items panel in `⌘K` — pick up where you left off.

---

## 4. PRD (prompt 14)

### Overview

BidStack 360° is Mantu's bid/presales CRM. It overlays Twenty CRM's data model with a custom cockpit, Dust agent bridge, and Apple-grade UX, while staying additive (no Twenty core mutations).

### User problem

Bid managers run on stale data and tab-fatigue. Twenty has the records; Dust has the agents; SAM.gov / Apollo / Clearbit have the enrichment. There's no place that combines them with a single source of truth + an audit trail.

### Goals

- **G1** — Bring time-to-bid-context from "half a day" to "30 seconds" (cockpit open → first action).
- **G2** — Every CRM change captured in audit log (no untracked PATCHes).
- **G3** — Dust agents reachable from every record page.
- **G4** — Twenty migration path preserved (overlay package frozen).

### Non-goals (v1)

- Email composition / send (deferred to Twenty / external).
- Calendaring (deferred to Twenty / external).
- Mobile-native apps (web-only).
- Multi-language UI (English-first; copy structured for later i18n).

### Audience

See "Personas" above.

### Core features

(see "MVP / v1 / v2" above; status reflects 2026-05-11)

### Requirements

**Functional**

- All CRUD entities (contacts, tasks, notes, opportunities) support optimistic + rollback mutations.
- Inline edit on opportunity stage / value / probability / due date.
- Pipeline kanban drag-and-drop + keyboard arrows for accessibility.
- Audit log appends on every mutating route.
- Multi-tenancy enforced server-side (org-scoped queries).

**Non-functional**

- LCP < 2.5s, INP < 200ms, CLS < 0.1 (Apple-aligned).
- All interactive components ship loading / error / empty / disabled / hover / focus / active states.
- WCAG 2.2 AA: 4.5:1 normal text contrast, 44×44 touch targets, full keyboard nav, `prefers-reduced-motion` respected.
- Dark mode parity with light.

### Edge cases

- Optimistic mutation conflict (two tabs editing same opp) — `onSettled` invalidates so the later write wins, last-write-wins captured in audit log.
- Redis unreachable — Dust resync falls back to in-memory dedup; webhooks return success but flag `error` in `sync_event`.
- Network offline — TanStack Query queues retries; toast surfaces final failure.
- Empty enrichment cache — favicon fallback for company logos.

### Technical considerations

- Node 24 LTS, pnpm 10, React 18, Vite 6, Tailwind 4, Fastify 5, Prisma 5, PostgreSQL 16, Redis 7.
- Clerk auth (prod) / stub auth (dev/E2E).
- Bundle: framer-motion / clerk / radix / tanstack / zod / react / react-dom in dedicated chunks.

### Success metrics

| Metric                | Target                      |
| --------------------- | --------------------------- |
| D1 retention          | ≥ 70%                       |
| D7 retention          | ≥ 55%                       |
| Time-to-first-cockpit | ≤ 30s (P50)                 |
| LCP                   | ≤ 2.5s (P75)                |
| INP                   | ≤ 200ms (P75)               |
| CLS                   | ≤ 0.1 (P75)                 |
| Audit log coverage    | 100% of PATCH/DELETE routes |
| Test pass rate        | ≥ 99 / 99                   |

### Launch scope

Internal launch: 5 bid managers + 2 AEs + CRO. Production target: Mantu workspace only.

### Roadmap (3 phases)

| Phase | Quarter | Theme           | Notable                                               |
| ----- | ------- | --------------- | ----------------------------------------------------- |
| 1     | 2026 Q2 | Hardening + ASO | Mobile-responsive shell, bulk actions, CSV export     |
| 2     | 2026 Q3 | Analytics       | Cohort dashboards, custom views, weekly digest emails |
| 3     | 2026 Q4 | Productize      | SSO, billing, multi-workspace, public Twenty MCP      |

---

## 5. Backend Logic (prompt 15)

### DB schema

Authoritative source: `packages/db/prisma/schema.prisma`. Key tables:

- `Org`, `User` (auth identity + org membership)
- `Opportunity` (the deal record — customer, name, stage, valueEur, probability, dueDate, ownerId)
- `Contact` (org-scoped person — customer, name, role, email, phone, influence, sentiment)
- `Task` (oppId, title, dueDate, status, assigneeId)
- `Note` (account-scoped — accountId, title, bodyMd, pinned)
- `File` (object-store key, accountId, name, kind, bytes)
- `CompanyEnrichment` (org + normalizedName unique — legalName, domain, website, logoUrl, registryIds, employeeCount, annualRevenueMicros, confidenceBps, sourceAttribution, cacheExpiresAt)
- `BidOpportunity` (external feed import — SAM.gov, SEAO, MERX, …)
- `RiskRegisterItem`, `ComplianceCheck`, `ProviderHealth`, `QueueHealth`, `ReleaseScore`
- `DashboardWidget` (per-org cockpit layout)
- `ApiKey` (orgId, name, hashedKey, prefix, scopes, lastUsedAt, revokedAt)
- `SyncEvent` (webhook + integration event log)
- `AuditLog` (orgId, userId, action, targetType, targetId, diff, createdAt)
- `AiInsight` (kind, title, summary, confidenceBps, sourceAttribution)

### Auth / roles

- Provider: Clerk (prod) / stub (dev). Every request hydrates `req.auth.{orgId, userId}` via plugin.
- Roles (v1): single-tier "member" — no admin/manager split yet.
- API keys: `read | write | mcp` scopes; SHA-256 hashed; secret revealed once.

### API endpoints (excerpt)

| Method                      | Path                                                                                 | Notes                                   |
| --------------------------- | ------------------------------------------------------------------------------------ | --------------------------------------- |
| GET / POST                  | `/api/opportunities`                                                                 | List + create                           |
| GET / PATCH                 | `/api/opportunities/:id`                                                             | Detail + inline edit                    |
| POST                        | `/api/opportunities/:id/stage`                                                       | Stage-only mutation (optimistic kanban) |
| POST                        | `/api/opportunities/:id/brief`                                                       | Trigger Dust briefing                   |
| GET / POST                  | `/api/contacts`                                                                      | List with `search` + create             |
| PATCH / DELETE              | `/api/contacts/:id`                                                                  | Edit + delete                           |
| GET / POST                  | `/api/tasks`                                                                         | List + create                           |
| PATCH                       | `/api/tasks/:id`                                                                     | Status / due-date toggle                |
| GET / POST / PATCH / DELETE | `/api/notes`                                                                         | Per-account                             |
| GET / POST / DELETE         | `/api/files`                                                                         | Per-account upload + revoke             |
| GET                         | `/api/crm/dashboard`                                                                 | Snapshot (cockpit)                      |
| GET / POST                  | `/api/crm/companies/{search,lookup,:id,:id/enrich}`                                  | Enrichment                              |
| GET                         | `/api/crm/{connectors,data-quality,provider-health,release-score,open-data/signals}` | Trust / observability                   |
| GET / POST / DELETE         | `/api/integrations/api-keys`                                                         | Settings                                |
| GET / POST                  | `/api/integrations/dust/{status,resync}`                                             | Dust                                    |
| GET                         | `/api/integrations/webhooks`                                                         | Sync event log                          |
| GET                         | `/api/audit-logs`                                                                    | Cursor-paginated audit feed             |
| GET                         | `/api/reports/pipeline`                                                              | Funnel report                           |
| GET                         | `/api/health`                                                                        | Liveness + Redis ping                   |

### Integrations

- **Dust** — workspace API for agent calls; webhooks bidirectional; MCP server exposes our tools to Dust.
- **Apollo** — BullMQ enrichment worker; fills `CompanyEnrichment` rows when `APOLLO_API_KEY` present.
- **SAM.gov / SEAO / MERX** — open-data connectors via the connectors catalog.
- **Clerk** — production auth; dev mode bypassed.

### Notifications

- v1: in-app toast only.
- v2: email digests + push (mobile).

### Storage

- Object store: S3-compatible (MinIO in dev). Keys: `orgs/{orgId}/accounts/{accountId}/{name}`.

### Payments

Internal; not applicable v1.

### Admin panel

Settings page covers: workspace identity, API keys, theme. No multi-user admin yet (single-tenant per workspace).

### Rate limits

- Mutating routes: 100 req/min per orgId (Fastify rate-limit plugin recommended for v2).
- Enrichment: 30 req/min per provider per orgId (worker-side throttle).

### Security risks (with mitigations)

| Risk                | Mitigation                                                                             |
| ------------------- | -------------------------------------------------------------------------------------- |
| Tenancy bleed       | Every Prisma query includes `where: { orgId }`; two-step find-then-update on mutations |
| API key leak        | SHA-256 hashed; revealed once; revoke endpoint                                         |
| Webhook replay      | `redis.set(key, '1', 'EX', 7d, 'NX')` dedup with in-memory fallback                    |
| Session token theft | httpOnly + secure + sameSite cookies via Clerk                                         |
| Audit log gaps      | Every mutating route appends to `AuditLog`                                             |
| OWASP Top 10        | Parameterized Prisma queries; Zod input validation; no string-concatenated SQL         |

---

## 6. UI Design System (prompt 16)

Brand style: **Apple-grade enterprise** — dense data, Apple typography, spring motion, premium dark mode.

### Tokens (excerpt from `apps/web/src/index.css`)

- **Color** — light + dark peer palettes. Brand primary `#2c4bff` (light) / `#6e85ff` (dark). Semantic: success `#1f8a5b`, warning `#d08a00`, danger `#d93849`, info `#6e59ff`. Tag palette: blue/jade/amber/tomato/purple/teal/rose/gray with `-bg` + `-fg` paired for AA contrast.
- **Typography** — `system-ui` first (SF Pro on Apple); `font-display` for headings with `-0.022em` tracking; `font-mono` for codes; `font-feature-settings: cv11 ss01 ss03 kern calt`; `letter-spacing: -0.005em` body.
- **Spacing** — Tailwind's 4px base (effectively an 8px scale at common increments).
- **Radius** — 6px / 8px / 10px / 14px scale.
- **Shadow** — `xs/sm/md/lg` elevation; `focus-ring` for keyboard.

### Components

| Component                  | Variants                                                 | States                                                                                         |
| -------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `Button`                   | primary / secondary / ghost / destructive × sm / md / lg | default / hover (`y: -0.5`) / focus (ring) / active (spring `scale 0.96`) / loading / disabled |
| `Card` / `InteractiveCard` | static / interactive                                     | hover-lift `y: -3` + shadow-up                                                                 |
| `Badge`                    | 8 tones                                                  | static (semantic)                                                                              |
| `Dialog` (Radix)           | —                                                        | spring entrance via framer-motion `AnimatePresence`                                            |
| `Toast`                    | success / error / info / warning                         | spring + bottom-right stack, auto-dismiss                                                      |
| `Confirm`                  | regular / destructive                                    | Promise-based                                                                                  |
| `Inline edit`              | text / number / date / select                            | click-to-edit, Enter commit, Esc cancel                                                        |
| `Tooltip` (new)            | —                                                        | hover/focus delay                                                                              |
| `Avatar` (new)             | initials / logo                                          | gradient fallback                                                                              |
| `Breadcrumbs` (new)        | —                                                        | last item is current page                                                                      |

### Navigation patterns

- Left **sidebar** with hover prefetch on every NavLink; collapsible (persisted).
- Top **topbar** with breadcrumbs + cmd-K hint + sync status pill.
- **Command palette** (cmd-K) — recents, sections, arrow nav, auto-scroll.

### Icon style

Currently a hand-rolled `Icon` component (`@/components/ui/Icon`); SVG stroked at 1.5px. Future: align with Lucide / SF Symbols once we settle on a final glyph library.

### Onboarding

v1: no onboarding (internal tool). v2: 3-screen tour on first visit (Apple-style page sheets with sequential reveals).

### Premium direction

**Premium feel = restraint.** Springs over keyframes; tabular numbers; SF typography; dark mode parity; no gradient noise. The cockpit dashboard's reveal sequence + the pipeline kanban's spring drops are the marquee moments.

---

## 7. Code Starter (prompt 17)

The codebase _is_ the starter — see `apps/web/src/` for:

- `main.tsx` — root + provider wiring (Auth, Query, Router, Web Vitals)
- `App.tsx` — route table with `AnimatedRoutes` (page transitions) + `Toaster` + `ConfirmHost`
- `lib/api.ts` — fetch wrapper with `ApiError` class
- `lib/motion.ts` — Apple spring tokens
- `lib/prefetch.ts` — nav chunk prefetcher
- `lib/web-vitals.ts` — `LCP` / `INP` / `CLS` observer
- `lib/palette-recents.ts` — localStorage-backed palette recents
- `hooks/*` — TanStack Query hooks with optimistic mutations
- `components/{cockpit,opportunity,contact,task,settings,integrations,layout,motion,ui}/*` — feature folders + shared primitives

Mock data: not present in the web app (live API in dev). API tests use Prisma against a test DB; integration tests in `apps/api/src/routes/*.test.ts` cover the critical flows.

---

## 8. App Audit (prompt 18)

### UX issues (severity → fix)

| Severity  | Issue                                                | Fix                                                                                  | Status  |
| --------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------ | ------- |
| Critical  | `alert()` / `window.confirm()` blocked the UI thread | Replaced with `toast.*` + `confirm({...})`                                           | ✅ done |
| Critical  | Setstate-in-effect tripping React 18 hook linter     | Refactored ContactDialog with keyed inner form; ConfirmDialog with `AnimatePresence` | ✅ done |
| Important | No optimistic mutation on inline edit                | TanStack Query optimistic + rollback on every write hook                             | ✅ done |
| Important | Pipeline kanban felt jumpy on drop                   | `layout` animations + spring on drop-target tint                                     | ✅ done |
| Important | Long lists re-rendered on every keystroke            | `useDeferredValue` + `useTransition` on filters                                      | ✅ done |
| Polish    | Filter chip press feedback delayed                   | `useTransition` keeps press snappy                                                   | ✅ done |
| Polish    | Loading state was a strobe pulse                     | Shimmer skeleton with sliding gradient                                               | ✅ done |
| Polish    | Route changes were silent for screen readers         | `RouteAnnouncer` aria-live region                                                    | ✅ done |

### Retention risks

| Risk                                | Mitigation                                                |
| ----------------------------------- | --------------------------------------------------------- |
| Cockpit overwhelms on first open    | Reveal sequencing staggers cards; KPI counters animate up |
| User can't find a specific opp fast | Command palette + opp search via cmd-K                    |
| Mutations feel like they round-trip | Optimistic updates + toast on success                     |

### Monetization mistakes

N/A v1 (internal tool). For productization: free-tier limits should be on enrichments (the cost driver), not seats.

### App Store / browser-extension risks

N/A (web app). If we ship mobile-native later: ATT, push-permission timing, screenshot localization.

### Privacy compliance

- GDPR scope clear: contacts data is personal. Audit log records intent; DELETE endpoint supports erasure.
- No PII in client-side localStorage other than the palette recents (entity labels, not raw contact data).

### Tech debt traps

| Trap                                     | Status                                         |
| ---------------------------------------- | ---------------------------------------------- |
| Twenty overlay drift if hand-edited      | Hard rule in CLAUDE.md; CI check could enforce |
| `any` casts                              | Few; flagged via lint                          |
| `console.log` shipped                    | Disallowed via lint                            |
| 50-line / 400-line function/file caps    | Lint configured                                |
| Tailwind v3 vs v4 canonical-class syntax | v3 used intentionally; saved feedback memory   |

### Cut list

- ~~Old `+ New account` button on Accounts → now wired to `CreateOpportunityDialog`~~ ✅
- ~~Unwired Export button~~ ✅ removed (re-add as v2 CSV export)
- ~~Hardcoded MCP tools list with stale names~~ ✅ refreshed
- Workflows tab on Integrations — deferred to v2

---

## 9. Launch Plan (prompt 19)

Internal launch — no public ASO. The checklist is operational, not marketing.

### Pre-launch checklist

- [ ] Prisma migrations applied to prod
- [ ] Clerk publishable + secret keys in env
- [ ] Redis reachable (Dust + webhook dedup)
- [ ] S3 bucket created + IAM access keys scoped
- [ ] `APOLLO_API_KEY` set (or accept enrichment skip)
- [ ] DUST_API_KEY + DUST_WORKSPACE_ID set
- [ ] CSP + HSTS headers configured on the reverse proxy
- [ ] Sentry / Datadog DSN wired
- [ ] Web Vitals reporting → analytics backend
- [ ] Audit log retention policy decided (default: unlimited)

### Beta plan

5 bid managers + 2 AEs + CRO. 2-week feedback cycle via private Slack channel; weekly digest of fixes shipped.

### Onboarding improvements

- Default to Mantu cockpit on first open.
- Surface "Press ⌘K to jump anywhere" tip in topbar (v2).
- Inline copy in empty states tells the user what to do next.

### Push plan

N/A v1 (no native app, no service worker). v2: web push for `task.due-soon`, `opportunity.stage_changed`, `dust.briefing_ready`.

### Referral loop

N/A v1 (single workspace).

### 30-day retention metrics

Track in analytics:

- D1 / D7 / D30 retention
- Mutations per active session (proxy for trust)
- Cockpit open → first action latency (P50/P95)
- LCP / INP / CLS P75
- Audit log diversity (action distribution per orgId per week)

---

## 10. Full App Lead (prompt 20)

| Phase           | Deliverables                                                                | Decisions                                                          | Risks                                      | Next                                                     |
| --------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------ | -------------------------------------------------------- |
| 1. Strategy     | This blueprint; PRD; persona deck                                           | Twenty overlay vs fork (overlay); Apple HIG as visual north star   | Twenty migration drift                     | Run prompt 11 again if scope shifts                      |
| 2. UX           | Screen flows above; design tokens in `index.css`; motion in `lib/motion.ts` | Inline edit > modal edit; cmd-K-first navigation                   | Dark mode parity slips                     | Run prompt 13 / 16 for any new screen                    |
| 3. Architecture | `docs/ARCHITECTURE.md`; folder layout above                                 | Zustand + React Query > Redux; framer-motion > custom CSS          | Bundle creep                               | Run prompt 12 if a new app is added (e.g. native mobile) |
| 4. Backend      | Prisma schema; route catalog above                                          | Two-step find-then-update for tenancy; audit log on every mutation | Redis SPOF for dedup                       | Run prompt 15 when payments / SSO land                   |
| 5. Code         | Web + API + worker + MCP shipped                                            | Optimistic UI on every CRUD; per-row memoization                   | None active                                | —                                                        |
| 6. QA           | This audit; tests passing 99/99                                             | Vitest > Jest; Playwright for E2E (v2)                             | Visual regression coverage missing         | Add Storybook + Chromatic in v2                          |
| 7. Launch       | Internal launch only v1                                                     | Beta in private Slack; no ASO                                      | Adoption — bid managers must change habits | Run prompt 19 if we productize externally                |

---

## Appendix — How this blueprint stays current

- Treat as the single source of truth for product direction. Architecture details live in `docs/ARCHITECTURE.md`.
- Bump the date in the header on every meaningful update. Don't fork into per-feature docs unless the topic deserves > 1 page on its own.
- When this blueprint and code disagree, **code wins** — open a PR to update this doc rather than the code.
