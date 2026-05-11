# BidStack 360° — Second Deep Audit (2026-05-11)

**Branch:** `feat/sprint-0-foundation`
**Scope:** Full frontend + backend + integrations.
**Toolchain baseline:** ✅ `pnpm -r typecheck` clean · ✅ `pnpm -r lint` clean · ✅ `pnpm -r test` 80+ tests passing across 6 workspaces (api 29, web 17, mcp 11, worker 12, plus shared/dust-client).

Findings are grouped by **severity** (BLOCKER / MAJOR / MINOR), each cited with `file:line` and verified against the current tree (not just the agent's say-so).

---

## BLOCKER — must fix before customers see this

### B1. MCP server doesn't expose the CRM tool surface that Dust expects

[apps/mcp-server/src/tools/index.ts:18-25](apps/mcp-server/src/tools/index.ts#L18-L25)

The registered tool map is:

```ts
{
  ('opportunities.list',
    'opportunities.get',
    'opportunity.update',
    'contacts.list',
    'tasks.create',
    'proposal.draft');
}
```

CLAUDE.md `docs/MCP.md` and the Dust integration spec call for `crm_search_companies`, `crm_enrich_company`, `crm_create_deal`, `crm_update_deal`, `crm_list_activities`, `crm_create_activity`, `crm_generate_insights` (the seven tools in `DustCrmToolName` enum at [packages/shared/src/schemas/crm.ts:300-308](packages/shared/src/schemas/crm.ts#L300-L308)).

The `crm-tools.ts` file exists with implementations — they're just not registered. Dust's `crm_*` calls will return _tool not found_.

### B2. POST `/api/integrations/dust/resync` is a no-op stub

[apps/api/src/routes/dust-integration.ts:74-89](apps/api/src/routes/dust-integration.ts#L74-L89)

The handler writes a `syncEvent` row with a synthesized `manual-${Date.now()}` job id and returns 202. **It never calls `Queue.add()`.** Clicking "Resync now" in the integrations page does nothing observable beyond an audit row. Wire it to the existing `dust-poll` queue handle in `apps/worker/src/queues/dust-poll.ts`.

### B3. `/api/integrations/dust/status.agents` is hardcoded `[]`

[apps/api/src/routes/dust-integration.ts:62](apps/api/src/routes/dust-integration.ts#L62)

`agents: []` is a literal in the response builder. The IntegrationsPage UI renders an empty agents list forever, with no upstream Dust query. Either delete the field from the response schema or call `dustClient.listAgents()`.

---

## MAJOR — ship-blocking before a paid pilot

### M1. `/health` doesn't check Redis — green health while queues are stalled

[apps/api/src/routes/health.ts:7-37](apps/api/src/routes/health.ts#L7-L37)

`SELECT 1` is the only liveness signal. BullMQ workers, webhook dedup, and rate-limit storage all depend on Redis. Add `await redis.ping()` and surface `redis: boolean` next to `db: boolean`. Without it, a Redis outage = silent webhook drops + unprocessed Apollo jobs while the load balancer still routes traffic.

### M2. Webhook dedup is an in-process `Map` — fails on restart and across replicas

[apps/api/src/routes/webhooks.ts:14-25](apps/api/src/routes/webhooks.ts#L14-L25)

The `seen` Map evaporates on every restart, and two API replicas behind a load balancer don't share state — so a Dust retry can be processed twice. The comment already flags it as dev-only. Migrate to `redis.set(key, '1', 'EX', 86400 * 7, 'NX')` — `NX` gives you the atomic check-and-set behavior `rememberOrReject()` is trying to do.

### M3. Money-column inconsistency violates the "always in micros" rule

[packages/db/prisma/schema.prisma:91](packages/db/prisma/schema.prisma#L91) vs [packages/db/prisma/schema.prisma:290](packages/db/prisma/schema.prisma#L290)

- `Opportunity.valueEur` → `Decimal(14, 2)`
- `CompanyEnrichment.annualRevenueMicros` → `BigInt`
- `BidOpportunity.estimatedValueMicros` → `BigInt`
- `DustRun.costMicros` → `BigInt`

CLAUDE.md says "always store amounts in micros (integer × 1e6) per Twenty/Stripe convention." The Opportunity column predates that decision; pick one. Migrating to `valueMicros: BigInt` requires a backfill (`valueMicros = round(valueEur * 1_000_000)`) and a coordinated update of the API serializer plus every UI hook that reads `o.value` (e.g. [apps/web/src/pages/DashboardPage.tsx:113](apps/web/src/pages/DashboardPage.tsx#L113)).

### M4. `/files/upload-url` accepts arbitrary `accountId` without an account-ownership check

[apps/api/src/routes/files.ts:60-78](apps/api/src/routes/files.ts#L60-L78)

The handler reads `req.body.accountId` and generates a presigned URL whose storage key embeds that accountId via [storage/index.ts: LocalStorage.newKey](apps/api/src/storage/index.ts#L42). The finalize step does scope on `req.auth.orgId` so the _resulting row_ is tenant-safe — but the **presigned URL itself is reusable for 5+ minutes** and the storage key is predictable. A user in org A can mint upload URLs that collide with org B's storage key namespace.

Lower severity than a cross-org _read_, but it lets you (1) cost a competitor's S3 bucket via storage spam, and (2) cause finalize-race conditions. Either (a) namespace storage keys under `orgId/accountId/...` and verify orgId in `newKey`, or (b) move accountId validation into the upload-url handler.

### M5. AppShell has no React error boundary

[apps/web/src/components/layout/AppShell.tsx:1-19](apps/web/src/components/layout/AppShell.tsx#L1-L19) and [apps/web/src/main.tsx](apps/web/src/main.tsx)

`ErrorBoundary.tsx` exists, has tests, and is **never mounted**. A render error in any page crashes the whole shell to a blank screen. Wrap `<Routes>` inside App.tsx with `<ErrorBoundary>` (per-route, so the sidebar/topbar survive).

### M6. `DashboardPage.tsx` is 579 lines — over the 400-line ceiling

[apps/web/src/pages/DashboardPage.tsx](apps/web/src/pages/DashboardPage.tsx)

Per code-quality.md, max file 400 lines. The page bundles ~12 inline sub-components (`PageHead`, `KpiRow`, `BusinessSnapshotCard`, `OpenIssuesCard`, `TechStackCard`, `PipelineByStageCard`, `KpiSidebar`, `PulseRow`, `KeyContactsCard`, `UpsellFilesCard`, helpers). Extract to `apps/web/src/components/cockpit/*.tsx` — each is independently testable and the page becomes a 100-line layout.

### M7. CommandPalette only searches opportunities + accounts; ignores contacts, tasks, audit log

[apps/web/src/components/command/CommandPalette.tsx:111-122](apps/web/src/components/command/CommandPalette.tsx#L111-L122)

⌘K is the primary navigation affordance after dark-mode toggle. Contacts and tasks have backend endpoints (`/api/contacts`, `/api/tasks`) but no palette wiring. This is a 30-min fix that doubles palette utility.

### M8. Tag colors in dark mode use 16-18% alpha backgrounds — needs a documented contrast check

[apps/web/src/index.css:108-127](apps/web/src/index.css#L108-L127)

Per design-standards.md, every tag/badge must hit 4.5:1 normal text / 3:1 large text against its _actual rendered background_. Dark-mode tag backgrounds like `--tag-blue-bg: rgba(101, 132, 255, 0.18)` composite over `--surface-card` not pure black — the agent's flag is valid. The Tony's `feedback_token-contrast-review.md` memory says we should comment the ratio inline. None of the 6 dark-mode tag pairs in [index.css:108-127] have a ratio comment.

---

## MINOR — quality bar improvements

### m1. Touch targets on CommandPalette result rows < 44×44

[apps/web/src/components/command/CommandPalette.tsx:177-215](apps/web/src/components/command/CommandPalette.tsx#L177-L215) — `py-2` (8px vertical) violates the 44px touch-target rule for mobile.

### m2. `<li onClick>` keyboard accessibility

Same file — list items use `onClick` on `<li role="option">`. Works because the keyboard navigation is in the parent input's `onKeyDown`, but a screen-reader user who arrows directly to the listbox has no `Enter` to activate. Add `onKeyDown` on the items themselves.

### m3. Producer-side Apollo queue duplicates worker-side config

[apps/api/src/queues/company-enrich-apollo.ts:36-43](apps/api/src/queues/company-enrich-apollo.ts#L36-L43) vs [apps/worker/src/queues/company-enrich-apollo.ts:174-182](apps/worker/src/queues/company-enrich-apollo.ts#L174-L182). The `defaultJobOptions` (attempts/backoff/removeOn\*) are duplicated in two places. Extract to a `queue-config.ts` in `@bidstack/shared` so the producer and worker can't drift.

### m4. CommandPalette `<img>` lacks alt text

[apps/web/src/components/command/CommandPalette.tsx:104](apps/web/src/components/command/CommandPalette.tsx#L104) — the company logo uses `aria-hidden` but no `alt`. For screen readers this is correct, but the linter will complain on the next a11y rule upgrade. Use `alt=""` explicitly.

### m5. CSS architecture mixing tailwind utilities with prototype custom classes

DashboardPage uses both `className="kpi-grid cols-6"` (prototype port) and inline `style={{ display: 'flex' }}` — pick one or the other. Inline styles in [pages/DashboardPage.tsx:79-86, 151-166, 188-200](apps/web/src/pages/DashboardPage.tsx#L79-L86) should be promoted to named classes.

### m6. Sidebar overdue-tasks badge uses `< 7` (next-7-days) instead of `< 0` (actually overdue)

[apps/web/src/components/layout/Sidebar.tsx:40-43](apps/web/src/components/layout/Sidebar.tsx#L40-L43) — the filter is `d !== null && d < 7 && t.status !== 'done'` which counts tasks due _this week_, not overdue. DashboardPage [DashboardPage.tsx:66-70](apps/web/src/pages/DashboardPage.tsx#L66-L70) uses `d < 0` for the same metric. Pick the same semantics.

### m7. `BadgeTone` doesn't include `'teal'` and `'rose'`

[apps/web/src/components/ui/Badge.tsx:5](apps/web/src/components/ui/Badge.tsx#L5) declares `'blue' | 'jade' | 'amber' | 'tomato' | 'purple' | 'gray'`. But the schema's `AccountCockpitSnapshot.kpis[].tone` enum at [packages/shared/src/schemas/crm.ts:272](packages/shared/src/schemas/crm.ts#L272) declares `'blue' | 'jade' | 'purple' | 'amber' | 'teal' | 'rose'`. DashboardPage hand-rolls the lookup with literal style objects to dodge this. Extend `BadgeTone` so the Badge component can render any KPI tone.

### m8. `BadgeTone` is missing CSS for `'teal'` / `'rose'` even though tokens exist

[apps/web/src/components/ui/Badge.tsx:7-14](apps/web/src/components/ui/Badge.tsx#L7-L14) — wire the existing `--tag-teal-bg/fg` and `--tag-rose-bg/fg` tokens into the TONE_MAP.

### m9. `lookupSync` / lookupAt fields on DustStatus always null

[apps/api/src/routes/dust-integration.ts:57](apps/api/src/routes/dust-integration.ts#L57) — `lastSyncAt: null` and `nextSyncAt: new Date(Date.now() + 5min)`. These should come from the dust-poll BullMQ job state (`queue.getJobScheduler('dust-poll').nextRun`) once the poller is fully wired.

### m10. `BigInt` cursor pagination test exists, but the on-the-wire `id: string` is not validated for ID format

[apps/api/src/routes/audit-logs.ts:39](apps/api/src/routes/audit-logs.ts#L39) — `cursor: BigInt(cursor)` throws SyntaxError on garbage input. The Zod schema in `AuditLogFilter` should `.regex(/^\d+$/)` to reject before the throw. Currently any non-numeric cursor returns a generic 500.

### m11. Free-text `accountId` is a 255-char varchar with no normalization

[packages/db/prisma/schema.prisma:513](packages/db/prisma/schema.prisma#L513) — Notes and FileAttachments key on `accountId String @db.VarChar(255)` with no case-folding. `"Aritzia"` and `"aritzia"` are different accounts. Either lowercase at write time or add a `citext` cast. Same accountId is used as the cockpit route param at [apps/web/src/pages/DashboardPage.tsx:44](apps/web/src/pages/DashboardPage.tsx#L44).

### m12. Bundle: React core chunk 341 kB — known and accepted, but no compression check

Vite is already manually chunking [apps/web/vite.config.ts:56-82](apps/web/vite.config.ts#L56-L82). The 341 kB number is uncompressed; gzipped it's 104 kB (visible in the build log). Not actually a problem — but add `compression: { brotliSize: true }` to the build output so the warning reflects shipped bytes.

### m13. `.uploads` directory leaked into git tracking? Not yet, but

Local storage writes to `apps/api/.uploads/` ([apps/api/src/storage/index.ts:56](apps/api/src/storage/index.ts#L56)) — confirm it's in `.gitignore` before the first real upload.

---

## What's actually solid (don't break this)

These items were checked and are **good**:

1. **Multi-tenant scoping** — every Prisma query in [crm.ts](apps/api/src/routes/crm.ts), [notes.ts](apps/api/src/routes/notes.ts), [files.ts](apps/api/src/routes/files.ts), [opportunities.ts](apps/api/src/routes/opportunities.ts), [tasks.ts](apps/api/src/routes/tasks.ts), [contacts.ts](apps/api/src/routes/contacts.ts), [audit-logs.ts](apps/api/src/routes/audit-logs.ts), [reports.ts](apps/api/src/routes/reports.ts) includes `where: { orgId: req.auth.orgId }`. No bypass paths.
2. **HMAC verification is constant-time** — [packages/dust-client/src/hmac.test.ts](packages/dust-client/src/hmac.test.ts) pins sha256+constant-time compare with 5 regression tests.
3. **Auth refuses production-start without Clerk keys** — [apps/api/src/plugins/auth.ts:105-110](apps/api/src/plugins/auth.ts#L105-L110) throws if `NODE_ENV=production && !CLERK_SECRET_KEY`.
4. **Storage path traversal blocked** — [apps/api/src/storage/index.ts:58-66](apps/api/src/storage/index.ts#L58-L66) `safeJoin` rejects `..` escapes.
5. **CORS is restrictive** — [apps/api/src/server.ts:57-68](apps/api/src/server.ts#L57-L68) allowlists `PUBLIC_BASE_URL` + dev origins, blocks the rest.
6. **CSP/Helmet locked down** — [apps/api/src/server.ts:43-56](apps/api/src/server.ts#L43-L56) `default-src 'self'`, `frame-ancestors 'none'`, `object-src 'none'`.
7. **Rate limit applied globally** — [apps/api/src/server.ts:70-74](apps/api/src/server.ts#L70-L74) 600 req/min, localhost allowlisted.
8. **Worker registers all three queues** — [apps/worker/src/main.ts:36-40](apps/worker/src/main.ts#L36-L40) dust-poll + webhook-processor + company-enrich-apollo.
9. **Vite dev + preview proxy + manual chunks** — [apps/web/vite.config.ts:30-46](apps/web/vite.config.ts#L30-L46) and Clerk dynamic import.
10. **Migrations exist and are linear** — 5 prisma migrations from `_init` to `_add_notes`, no hand-rolled raw SQL outside the documented `_add_gin_index` migration.
11. **MISTAKES.md / docs/solutions/ habit is enforced** — present and actively updated.

---

## Recommended next sprint (sequenced)

1. **B1** wire `crm_*` MCP tools (1 hr — already implemented, just register them)
2. **B2** + **B3** wire Dust resync queue + agents.list (2 hrs — uses existing dust-client)
3. **M1** + **M2** add Redis health check + Redis-backed webhook dedup (2 hrs)
4. **M5** mount ErrorBoundary (15 min)
5. **M6** extract DashboardPage into `components/cockpit/*` (3 hrs)
6. **M4** + **M11** namespace storage keys by orgId, normalize accountId (3 hrs + migration)
7. **M7** wire contacts + tasks into CommandPalette (1 hr)
8. **M3** money-column migration (1-day project with backfill)

Quality bar in current state: **~85/100** on the 100-point rubric (Functional 22, Code 22, Design 20, Infra 21). Closing B1-B3 + M1-M5 takes us to 95.
