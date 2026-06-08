# MISTAKES — BidStack 360°

Per Tony's `mistakes-protocol.md`:

- Read this BEFORE every task
- Log EVERY mistake immediately (root cause, prevention rule, category)
- Never repeat a logged mistake — if a repeat is detected, HALT and escalate
- After completing a non-trivial fix, write a `docs/solutions/` entry for reuse

---

## Format

```
### [TIMESTAMP] CATEGORY: Short description
- **What went wrong:** ...
- **Root cause:** ...
- **Prevention rule:** ...
- **Files affected:** ...
```

Categories: BUG, ARCHITECTURE, SECURITY, PERFORMANCE, UX, TESTING, INFRA, PROCESS.

---

## Ledger

<!-- New entries appended at the top of this section. -->

### 2026-06-07 BACKEND: Assumed a named integration config constraint existed

- **What went wrong:** The first provider credential live smoke returned `500`
  because the route used `ON CONFLICT ON CONSTRAINT
  integration_configs_org_type_name_key`, but the live local DB does not have
  that named constraint. The existing Dust credential route had the same
  fragile assumption.
- **Root cause:** I trusted schema-intent naming without verifying the live
  database constraint inventory before using a named constraint in raw SQL.
- **Prevention rule:** Before using `ON CONFLICT ON CONSTRAINT`, inspect the
  live DB for the constraint or add an additive migration. For compatibility
  credential writes, use transaction-scoped advisory locks plus update-or-insert
  and keep audit writes in the same transaction.
- **Files affected:** `apps/api/src/routes/agent-provider-credentials.routes.ts`,
  `apps/api/src/routes/dust-credentials.routes.ts`.

### 2026-06-07 TESTING: API consumer test ran before shared dist was rebuilt

- **What went wrong:** A focused API helper test failed with an undefined shared schema after `packages/shared` was changed.
- **Root cause:** The API imports shared schemas from the workspace package dist. Running the API consumer test while the shared package build was still in progress meant the consumer saw stale compiled output.
- **Prevention rule:** When shared schemas/types change, complete `pnpm --filter @bidstack/shared build` before running API or web consumer tests.
- **Files affected:** `packages/shared/src/schemas/rfp-agent.schemas.ts`, `apps/api/src/services/agents/agents.helpers.test.ts`.

### 2026-06-07 TESTING: Provider-readiness test assumed Dust env was absent

- **What went wrong:** A provider-readiness test expected Dust to report both missing env keys, but the local machine already had a Dust workspace env value.
- **Root cause:** The test did not own its environment. It relied on developer-machine absence rather than explicitly clearing the env keys relevant to the assertion.
- **Prevention rule:** Tests that assert missing or present env contracts must explicitly set and restore every env key they own.
- **Files affected:** `apps/api/src/services/agents/agents.helpers.test.ts`.

### 2026-06-07 SECURITY: High-only audit gate hid moderate dependency advisories

- **What went wrong:** The high-severity audit gate passed while the dependency graph still contained three moderate advisories: `i18next-http-backend`, `react-router`/`react-router-dom`, and transitive `ws`.
- **Root cause:** The release hygiene check stopped at `--audit-level high`, and the repo's already-dirty manifests/lockfile meant a later `pnpm install` refreshed more lockfile state than the narrow advisory patch alone.
- **Prevention rule:** Enterprise dependency remediation must inspect full `pnpm audit --json`, patch direct deps or compatible overrides surgically, and document any pre-existing lockfile drift before claiming the diff scope.
- **Files affected:** `package.json`, `apps/web/package.json`, `apps/marketing/package.json`, `pnpm-lock.yaml`, `docs/solutions/dependency-audit-zero-advisory-remediation.md`.

### 2026-06-07 TESTING: Opportunity list test assumed first row was a seed fixture

- **What went wrong:** Root `pnpm test` failed because `opportunities.integration.test.ts` expected the first `/api/opportunities?limit=20` item to have an `OP-NNNN` code, but parallel RFP approval tests can create valid `RFP-*` opportunities that sort ahead of seeded records.
- **Root cause:** The test mixed two contracts: tolerant persisted list reads and canonical seed-fixture identity. It relied on `updatedAt` order in a shared test org while API integration files run in parallel.
- **Prevention rule:** List tests in shared test tenants must not infer fixture identity from sorted position. Assert the page item shape separately, then locate the intended fixture by stable DB identity or a scoped search.
- **Files affected:** `apps/api/src/routes/opportunities.integration.test.ts`, `docs/solutions/opportunity-list-tests-must-not-assume-order.md`.

### 2026-06-07 TESTING: Meeting-import tests polluted shared contact baselines

- **What went wrong:** Full web E2E showed contact and responsive visual regressions after earlier meeting-import flows created test contacts in the shared seed organization and left them visible to later screenshots.
- **Root cause:** The account/notes import paths used production-like API flows in tests but did not clean up the generated contacts, notes, tasks, risks, and enrichment rows. Later tests assumed curated seed data but were reading a polluted shared org.
- **Prevention rule:** Any E2E or API test that writes into the shared seed org must clean up its own explicit fingerprints before and after the test. Do not update visual snapshots until shared test-data pollution is ruled out.
- **Files affected:** `apps/web/e2e/fixtures/test-data-cleanup.ts`, `apps/web/e2e/accounts.spec.ts`, `apps/web/e2e/contacts.spec.ts`, `apps/web/e2e/responsive/mobile-iphone-se.spec.ts`, `apps/web/e2e/responsive/mobile-pixel-7.spec.ts`, `apps/web/e2e/responsive/tablet-ipad.spec.ts`, `apps/api/src/routes/notes.test.ts`, `docs/solutions/e2e-meeting-import-test-artifacts.md`.

### 2026-06-07 BUG: Idle cockpit fix missed tab-discard reloads

- **What went wrong:** The account cockpit could still show the fatal "Couldn't load the CRM cockpit" state after a long idle if the browser discarded/reloaded the tab and the next live dashboard request returned a transient 5xx.
- **Root cause:** The first stale-refresh fix protected only React Query's in-memory `data`. A tab discard/reload loses that memory, so the page had no last verified snapshot to render during a transient API/proxy failure.
- **Prevention rule:** Long-lived CRM work surfaces need a tab-scoped, schema-validated fallback for the last verified entity snapshot. Use it only for transient 5xx/network failures, never for 4xx authorization or not-found failures, and clear it on auth cache cleanup.
- **Files affected:** `apps/web/src/pages/DashboardPage.tsx`, `apps/web/src/pages/DashboardPage.test.tsx`, `apps/web/src/lib/queryCache.ts`, `apps/web/src/lib/queryCache.test.ts`, `docs/solutions/account-cockpit-tab-discard-fallback.md`.

### 2026-06-07 BUG: Opportunity reads rejected legacy persisted codes

- **What went wrong:** The full API gate found `GET /api/v1/opportunities?limit=20` could return `500` because response serialization rejected persisted opportunity codes that did not match `OP-NNNN`.
- **Root cause:** The shared read schema reused the write-time canonical code regex, so historical/RFP/test/imported identifiers were treated as invalid at the response boundary.
- **Prevention rule:** Split read and write contracts for identifiers. Reads must tolerate bounded persisted legacy values; writes/imports can enforce the current canonical format.
- **Files affected:** `packages/shared/src/schemas/opportunity.ts`, `packages/shared/src/schemas/opportunity.test.ts`, `docs/solutions/opportunity-code-read-write-contract.md`.

### 2026-06-07 INFRA: Redis health client could stay unhealthy after a transient disconnect

- **What went wrong:** `/readyz` reported `redis:false` and stayed `503` even though Redis was reachable on the configured local port, leaving the API in a degraded state after an idle/startup blip.
- **Root cause:** The shared API Redis client disabled retries/offline queueing for fail-fast commands but had no deliberate reconnect path from ended or closed ioredis states.
- **Prevention rule:** Fail-fast Redis clients still need an explicit readiness/cache reconnect helper. Health checks should call that helper and cache code should reconnect once before falling back to memory.
- **Files affected:** `apps/api/src/redis.ts`, `apps/api/src/lib/redis-cache.ts`, `apps/api/src/routes/health.ts`, `apps/api/src/redis.test.ts`, `docs/solutions/redis-readiness-reconnect.md`.

### 2026-06-07 TESTING: DB probe skipped the app env bootstrap

- **What went wrong:** A direct Prisma/tsx probe failed because `DATABASE_URL` was not loaded in that standalone shell context.
- **Root cause:** I used an ad hoc eval context instead of the package/API test bootstrap that loads the repo's environment configuration.
- **Prevention rule:** When probing database-backed app behavior, use the API route, package tests, or explicitly load the same env bootstrap as the app; do not assume standalone `tsx -` has database config.
### 2026-06-07 BACKEND: Used `$queryRaw` for a void advisory-lock call

- **What went wrong:** The first duplicate-run lock used `tx.$queryRaw` for `SELECT pg_advisory_xact_lock(...)`, and the focused integration test returned a `500` because Prisma could not deserialize the `void` result.
- **Root cause:** I treated every `SELECT` as row-returning instead of matching the raw Prisma method to whether the statement produces data that the application needs.
- **Prevention rule:** Use `$executeRaw` for advisory locks and other side-effect SQL where the result is not consumed; use `$queryRaw` only when the application needs returned rows.
- **Files affected:** `apps/api/src/services/agents/agents.service.ts`, `apps/api/src/routes/agents.integration.test.ts`.

- **Files affected:** none.

### 2026-06-07 TESTING: i18n interpolation was missing in a component test

- **What went wrong:** The full web test gate failed because `CurrencySelector.test.tsx` rendered translated labels without app i18n initialization.
- **Root cause:** The focused test did not import the runtime i18n bootstrap, so interpolation placeholders appeared in assertions.
- **Prevention rule:** Tests that inspect translated/interpolated UI must import `@/i18n` or mock translation with equivalent interpolation behavior.
- **Files affected:** `apps/web/src/components/layout/CurrencySelector.test.tsx`.

### 2026-06-07 TESTING: Full API test gate used too-short timeout

- **What went wrong:** A full API package test run timed out before completion on this machine, then passed with a longer timeout.
- **Root cause:** The command timeout was too low for the current API integration suite size and local database setup.
- **Prevention rule:** Use at least 300 seconds for full API package tests and at least 600 seconds for root `pnpm test`.
- **Files affected:** none.

### 2026-06-06 TOOLING: Forked subagent spawn repeated role-override mistake

- **What went wrong:** I tried to spawn a full-history forked subagent with an explicit `agent_type`, which this tool rejects because forked agents inherit the parent role/model.
- **Root cause:** I repeated an already logged tool constraint instead of using either a non-forked role-specific agent or a forked agent without role overrides.
- **Prevention rule:** For `fork_context: true`, omit `agent_type`, `model`, and `reasoning_effort`; if a specific role is needed, spawn without full-history fork context.
- **Files affected:** none.

### 2026-06-06 TESTING: Root test gate used too-short shell timeout

- **What went wrong:** The first root `pnpm test` run timed out and produced an `EPIPE` artifact even though the later longer run passed.
- **Root cause:** A 240-second command timeout was too short for the full root test gate on this machine.
- **Prevention rule:** Use at least a 600-second timeout for root `pnpm test`, or run targeted package tests before the full gate when iterating.
- **Files affected:** none.

### 2026-06-05 UX: Shared CRM surfaces used automatic glow and shimmer loops

- **What went wrong:** Shared buttons/cards still applied dark-mode pulsing glow or shimmer effects, so routine CRM screens could feel flashy and purple-tinted even after the cursor spotlight animation was removed.
- **Root cause:** The visual system mixed marketing-style ambient motion with enterprise app interaction feedback; shared primitives amplified that pattern across many pages.
- **Prevention rule:** Shared CRM primitives may use tactile hover/press/reveal motion, but must not ship automatic ambient pulse, shimmer, orb, or neon glow loops unless the user explicitly asks for a hero/marketing surface.
- **Files affected:** `apps/web/src/components/ui/Button.tsx`, `apps/web/src/components/ui/Card.tsx`, `apps/web/src/components/ui/GlassCard.tsx`, `apps/web/src/components/layout/RouteProgress.tsx`, `apps/web/src/index.css`.

### 2026-06-05 BUG: Settings admin panels called unbounded backend reads

- **What went wrong:** The Settings page rendered but background requests for lead rot config, email templates, and tags returned 400s from the development query guard.
- **Root cause:** The route handlers used tenant-scoped `findMany` calls without explicit `take` limits. Lead rot then exposed a second bug: synthetic fallback ids were deterministic strings but not valid UUIDs, causing response serialization to return 500.
- **Prevention rule:** Admin/settings reads must be explicitly bounded and must pass the same response schemas as persisted rows; deterministic client placeholders still need valid wire-format ids.
- **Files affected:** `apps/api/src/routes/lead-rot.ts`, `apps/api/src/routes/email-templates.ts`, `apps/api/src/routes/tags.ts`, `apps/api/src/routes/settings-support.integration.test.ts`.

### 2026-06-05 TESTING: Prisma generate raced with API integration tests

- **What went wrong:** I launched Prisma client generation in parallel with an API integration test, so Vitest tried to use the Windows query-engine DLL while generation was replacing it.
- **Root cause:** The generated Prisma client on Windows uses a DLL that can be renamed/replaced during `prisma generate`; tests that import the client must not run at the same time.
- **Prevention rule:** Run `pnpm db:generate` as a sequential preflight before API tests, never in parallel with tests or a live API process that is being verified.
- **Files affected:** generated Prisma client state only.

### 2026-06-05 INFRA: Vite proxy returned API 500s when the API dev server was down

- **What went wrong:** Browser smoke showed the CRM workspace shell but repeated 500s for `/api/v1/...` calls through the Vite dev server.
- **Root cause:** The web dev server was alive on port 5173, but the API process had fallen off port 4000; the Vite proxy surfaced the missing upstream as 500s.
- **Prevention rule:** Local CRM smoke must verify both `/readyz` on the API and page-level network responses; a rendered shell is not enough.
- **Files affected:** runtime dev process state only.

### 2026-06-05 PERFORMANCE: Opportunities list queries timed out without list-view indexes

- **What went wrong:** The opportunities integration test timed out on list and stage-move flows, and logs showed slow `Opportunity.findMany` and `Comment.groupBy` queries.
- **Root cause:** The list route filters by org/deleted status and sorts by updated date, but the database lacked that composite index. Comment count aggregation also filtered deleted comments without a matching composite index.
- **Prevention rule:** Enterprise list views need indexes for the exact filter/order shape used by the API, including soft-delete columns and batch aggregation filters.
- **Files affected:** `packages/db/prisma/schema.prisma`, `packages/db/prisma/migrations/20260605190000_opportunity_list_indexes/migration.sql`.

### 2026-06-05 UX: Dashboard KPI cards overlapped at standard workspace widths

- **What went wrong:** The dashboard KPI cards looked fake and cramped because label, value, and mini-signal content collided at a 1440px workspace viewport.
- **Root cause:** The six-card grid used fixed equal columns, and the compact three-column KPI layout activated too early while the persistent sidebar reduced available content width.
- **Prevention rule:** Dashboard cards with embedded visual signals must use minimum track widths and only switch to inline signal layouts after measuring the real content area, not the raw browser width.
- **Files affected:** `apps/web/src/index.css`, `apps/web/src/styles/org-dashboard.css`.

### 2026-06-05 BUG: Pipeline stage moves confirmed but appeared to snap back

- **What went wrong:** Dragging an opportunity to another pipeline section could show a successful move while the card stayed in the old section or rendered with stale stage data.
- **Root cause:** The frontend optimistic update changed `pipelineStageId` without keeping the human `stage` and populated `pipelineStage` object coherent, so grouped views could still classify the record by stale fields.
- **Prevention rule:** Cache updates for relational status changes must update every field used by grouping, display, and detail views, then reconcile with the server-confirmed response.
- **Files affected:** `apps/web/src/hooks/useStageMutation.ts`, `apps/web/src/hooks/useStageMutation.test.tsx`.

### 2026-06-05 BUG: Direct CRM routes opened the marketing shell in local stub auth

- **What went wrong:** Visiting `/dashboard` or `/pipeline` directly in local dev could show the public landing experience instead of the authenticated CRM workspace.
- **Root cause:** Stub auth initialized as signed out unless a local session key already existed, even though the local API and dev workspace assume a signed-in stub user.
- **Prevention rule:** Local stub auth should default to the authenticated development user and only stay signed out after an explicit stub sign-out flag.
- **Files affected:** `apps/web/src/lib/auth.tsx`, `apps/web/src/lib/auth.test.tsx`.

### 2026-05-31 TESTING: Full E2E timeout produced misleading connection-refused artifacts

- **What went wrong:** I ran the full Playwright suite with a 10-minute shell timeout, which killed the Playwright web server near the end and left failure artifacts showing `ERR_CONNECTION_REFUSED` instead of the real state.
- **Root cause:** The suite takes roughly eight minutes plus build/server startup on this machine, so the shell timeout was too close to the actual gate runtime.
- **Prevention rule:** Full E2E gates need a timeout comfortably above the expected suite duration; if the shell times out, inspect artifacts as timeout fallout before treating connection-refused traces as product bugs.
- **Files affected:** none.

### 2026-05-31 TESTING: Worker Vitest wrapper crashed under package lifecycle on Windows

- **What went wrong:** `pnpm test` failed inside the worker test preflight even though the worker tests passed when run directly from the repo root.
- **Root cause:** The wrapper derived the workspace path from the script URL and then launched Vitest from a package lifecycle cwd; on Windows this combination made the child Vitest process exit before collecting tests.
- **Prevention rule:** Workspace-level helper scripts that may be launched from root or package cwd should discover the repo root from a durable workspace marker such as `pnpm-workspace.yaml`.
- **Files affected:** `scripts/run-worker-tests.mjs`.

### 2026-05-31 BUG: Booking timezone validation rejected slots it had offered

- **What went wrong:** The public booking UI could display an available America/New_York slot, but booking the same wall-clock time could be rejected as unavailable.
- **Root cause:** The timezone conversion path mixed UTC setters with local wall-clock intent and the create route derived the booking date from UTC instead of the visitor/page timezone.
- **Prevention rule:** Calendar availability must centralize IANA timezone conversion and include regression coverage for western timezones where UTC date and local date can differ.
- **Files affected:** `packages/shared/src/calendar/availability.ts`, `packages/shared/src/calendar/availability.test.ts`, `apps/api/src/routes/bookings-public.ts`.

### 2026-05-31 INFRA: Prisma schema drift hid behind generated client success

- **What went wrong:** Proposal-related tests failed earlier because the generated client knew about fields that the local database had not migrated yet.
- **Root cause:** `prisma generate` succeeded, but pending migrations had not been deployed to the active local database.
- **Prevention rule:** When a test fails with a missing database column after typecheck succeeds, check migration status and run migrate deploy against the active test/dev database without printing secrets.
- **Files affected:** database state only.

### 2026-05-30 TESTING: E-signature success locator matched hidden/live copy

- **What went wrong:** After the public signing flow reached confirmation, Playwright still failed because the success locator matched the screen-reader announcement, heading, and body copy at once.
- **Root cause:** The POM used a broad text regex for a terminal state that has multiple valid success strings on the same screen.
- **Prevention rule:** Public flow POMs should assert a unique semantic element for terminal states, usually the visible heading, not broad text that can collide with aria-live or body copy.
- **Files affected:** `apps/web/e2e/pages/PublicSignPage.ts`.

### 2026-05-30 BUG: Internal signing crashed when optional PDF renderer was absent

- **What went wrong:** After the frontend submitted a valid signature, the API returned 500 because `htmlToPdf` treated Puppeteer as optional at startup but threw at runtime with no fallback.
- **Root cause:** The document service had a lazy optional dependency contract without a second renderer path, so the internal provider could not complete in clean installs that lack Puppeteer.
- **Prevention rule:** Optional runtime renderers must have a verified fallback or startup must fail closed before any user can enter the workflow.
- **Files affected:** `apps/api/src/services/documents/document.service.ts`, `apps/api/package.json`, `pnpm-lock.yaml`.

### 2026-05-30 BUG: E-signature submit step lost drawn signature

- **What went wrong:** Full E2E failed because a signer could draw a signature, continue to review, accept terms, and then receive "Signature is missing."
- **Root cause:** The canvas-backed `SignaturePad` unmounted when the flow moved from the sign step to the submit step, so the submit handler could no longer read `padRef.current`.
- **Prevention rule:** Multi-step forms must persist canonical user input before unmounting the step that owns the interactive widget; submit handlers must not depend on refs from previous steps.
- **Files affected:** `apps/web/src/pages/PublicSignPage.tsx`.

### 2026-05-30 TESTING: DB utility script used disallowed console logs

- **What went wrong:** Workspace lint failed because `packages/db/scripts/drop-index.ts` used `console.log`, while the repo lint policy only allows `console.error` and `console.warn`.
- **Root cause:** A utility script used casual status logging instead of the repo-approved output path.
- **Prevention rule:** CLI utility status output should use `process.stdout.write` or the package logger; reserve `console.error/warn` for actual errors and warnings.
- **Files affected:** `packages/db/scripts/drop-index.ts`.

### 2026-05-30 TESTING: Root lint hid the package-level JSX escape error

- **What went wrong:** The root lint gate returned exit code 1 with no useful detail until package-level lint exposed `react/no-unescaped-entities` in the public booking confirmation copy.
- **Root cause:** A JSX apostrophe in user-facing copy was not escaped, and the recursive lint wrapper did not surface package output reliably in this shell.
- **Prevention rule:** When root lint fails without detail, run targeted package lint immediately; JSX copy must escape apostrophes or use string expressions.
- **Files affected:** `apps/web/src/pages/PublicBookingPage.tsx`.

### 2026-05-30 BUG: Booking create recomputed availability without visitor timezone

- **What went wrong:** The public booking UI showed a slot from the timezone-aware availability endpoint, but submitting the same slot could return "That time is no longer available."
- **Root cause:** `POST /booking-pages/:slug/bookings` accepted `tz` but did not pass it into `computeSlots`, so creation validation used UTC while availability used the visitor timezone.
- **Prevention rule:** Reservation-style create endpoints must replay the exact same validation inputs as their preview/availability endpoints.
- **Files affected:** `apps/api/src/routes/bookings-public.ts`, `apps/api/src/routes/bookings.helpers.ts`.

### 2026-05-30 UX: Selected integration tab failed contrast and dashboard chart had invalid ARIA

- **What went wrong:** Axe found a low-contrast selected integration tab eyebrow and an ARIA label on a generic dashboard chart wrapper.
- **Root cause:** The selected tab reused muted text on a tinted background, and the decorative chart container had `aria-label` without an explicit semantic role.
- **Prevention rule:** When adding ARIA labels to non-interactive visual wrappers, provide a valid role or keep them decorative; selected states must use foreground tokens with WCAG AA contrast on tinted surfaces.
- **Files affected:** `apps/web/src/pages/integrations/ConnectionCommandCenter.tsx`, `apps/web/src/components/dashboard/widgets/PipelineCard.tsx`.

### 2026-05-30 TESTING: Core Web Vitals suite self-contended under full parallelism

- **What went wrong:** The expanded E2E cluster reported extreme LCP failures on dashboard, pipeline, leads, and opportunities, but the Web Vitals suite passed when run alone with one worker.
- **Root cause:** The performance file inherited Playwright `fullyParallel`, so multiple lab measurements hit the same preview/API server at once and measured local contention instead of route paint quality.
- **Prevention rule:** Performance-budget specs must opt into serial execution, and the default E2E gate should use one worker unless the harness provisions isolated servers per worker.
- **Files affected:** `apps/web/e2e/performance/core-web-vitals.spec.ts`.

### 2026-05-30 INFRA: Static app-shell cache lookup respected `Vary: Origin`

- **What went wrong:** The service worker served the offline HTML shell, but module scripts such as `index`, `react`, and `react-dom` still failed to load offline.
- **Root cause:** The service worker cached static assets from its own fetch context, while Vite responses include `Vary: Origin`; later page module requests had different request headers, so `cache.match(request)` missed valid cached assets.
- **Prevention rule:** For same-origin hashed static app-shell assets, use `cache.match(request, { ignoreVary: true })`; keep API/data cache lookups strict.
- **Files affected:** `apps/web/public/sw.js`.

### 2026-05-30 TESTING: PWA E2E used a fixed readiness sleep

- **What went wrong:** The offline app-shell test passed in isolation but failed under parallel load because it switched the browser offline after a fixed 1-second delay.
- **Root cause:** The test waited for time instead of waiting for an active service worker controller and verified Cache Storage entries for the app shell.
- **Prevention rule:** PWA tests must wait on browser readiness signals and cached app-shell assets, never arbitrary sleeps, before forcing offline mode.
- **Files affected:** `apps/web/e2e/flows/pwa-offline.spec.ts`.

### 2026-05-30 INFRA: PWA warmup used conditional cache responses

- **What went wrong:** Offline reload still failed because core JS chunks such as `index`, `react`, `router`, and `vendor` were not available from Cache Storage.
- **Root cause:** `cache.add` allowed browser conditional-cache behavior during warmup; trace showed service-worker warmup requests with validators and empty captured bodies.
- **Prevention rule:** PWA warmup for app-shell JS/CSS must fetch with `cache: "reload"` and then `cache.put` the full response explicitly.
- **Files affected:** `apps/web/public/sw.js`, `apps/web/src/main.tsx`.

### 2026-05-30 BUG: Service worker served stale booking availability API data

- **What went wrong:** The public booking UI showed a slot that the booking mutation then rejected as no longer available.
- **Root cause:** The service worker used stale-while-revalidate for all GET API calls, including booking availability where stale data is unsafe.
- **Prevention rule:** Service workers must use network-first for API data and avoid stale responses for reservation, auth, permission, or financial reads.
- **Files affected:** `apps/web/public/sw.js`.

### 2026-05-30 TESTING: Booking confirmation selector matched heading and copy

- **What went wrong:** The full booking E2E succeeded in the UI but failed strict mode because the confirmation locator matched both the heading and supporting copy.
- **Root cause:** The POM used broad page text instead of the stable confirmation heading.
- **Prevention rule:** Success-state POM locators must target a single role or test id, especially when headings and body copy intentionally repeat the same concept.
- **Files affected:** `apps/web/e2e/pages/PublicBookingPage.ts`.

### 2026-05-30 INFRA: PWA page-side cache warming was load-sensitive

- **What went wrong:** The offline app-shell test passed in isolation but failed in a parallel E2E cluster.
- **Root cause:** Page-side cache warming could still be racing with the test's offline switch under load, leaving hashed Vite chunks uncached.
- **Prevention rule:** Service worker install must deterministically cache build-manifest assets; page-side cache warming is only a supplemental fallback.
- **Files affected:** `apps/web/public/sw.js`, `apps/web/src/main.tsx`.

### 2026-05-30 BUG: Public booking availability used unbounded reads

- **What went wrong:** The public booking flow seeded `test-slug`, but availability returned 400 because the query guard rejected unbounded calendar-event and booking lookups.
- **Root cause:** The route scoped by org/page/time range but did not include explicit `take` limits, so the development query guard correctly treated the reads as unsafe.
- **Prevention rule:** Any `findMany` added to request paths must include an explicit, business-justified bound and deterministic order before E2E coverage depends on the route.
- **Files affected:** `apps/api/src/routes/bookings-public.ts`, `apps/api/src/routes/bookings-pages.ts`.

### 2026-05-30 INFRA: Offline app shell missed hashed Vite assets

- **What went wrong:** After the service worker served `/dashboard` offline, the React app still did not render a main landmark.
- **Root cause:** The service worker cached the HTML shell, but the first controlled page did not reliably cache the hashed JS/CSS assets before Playwright switched the browser offline.
- **Prevention rule:** Production PWAs must warm the app-shell cache with the current document's hashed scripts and styles, not only `/` and `/index.html`.
- **Files affected:** `apps/web/src/main.tsx`, `apps/web/public/sw.js`.

### 2026-05-30 TOOLING: Root tsx could not resolve package-local dotenv-flow

- **What went wrong:** I tried to inspect booking data with root `pnpm exec tsx`, but the script imported `dotenv-flow`, which is available to the DB package rather than the root runtime.
- **Root cause:** I used the wrong workspace package context for a package-local inspection.
- **Prevention rule:** Run ad-hoc package inspections with `pnpm --filter <package> exec` or use package-local scripts so dependency resolution matches the code being inspected.
- **Files affected:** none.

### 2026-05-30 BUG: Deferred UI persistence fallback used narrowed window

- **What went wrong:** Web typecheck failed because the `requestIdleCallback` branch narrowed `window` such that `window.setTimeout` was typed as unavailable in the fallback.
- **Root cause:** I used `window.setTimeout` after an `in` guard instead of the safer `globalThis.setTimeout`.
- **Prevention rule:** When feature-detecting optional browser APIs, use `globalThis.setTimeout` or capture fallback functions before narrowing.
- **Files affected:** `apps/web/src/stores/ui.ts`.

### 2026-05-30 TESTING: Full E2E failure summary was hidden by noisy logs

- **What went wrong:** The full Playwright run failed, but the terminal output was dominated by web-server logs and truncated before the actual failure list.
- **Root cause:** I relied on raw command output instead of immediately reading `apps/web/test-results` artifacts after a large run.
- **Prevention rule:** For full E2E runs, inspect Playwright artifacts first after any non-zero exit; use terminal output only as supplemental context.
- **Files affected:** none.

### 2026-05-30 TESTING: Booking availability POM returned before terminal state

- **What went wrong:** `/book/test-slug` showed "Booking page not found", but the POM marked the page available because it checked while the loading heading was visible and before the fetch failure rendered.
- **Root cause:** The availability helper checked for a heading instead of waiting for either a usable booking calendar/time-slot or the not-found error state.
- **Prevention rule:** Public-flow availability helpers must wait for a terminal UI state before deciding to run or skip a flow.
- **Files affected:** `apps/web/e2e/pages/PublicBookingPage.ts`.

### 2026-05-30 TESTING: Workflow POM used an ambiguous creation button

- **What went wrong:** The workflow builder test failed strict mode because the page intentionally renders "New workflow" in both the toolbar and empty state.
- **Root cause:** The POM selected by broad accessible name without scoping to the first primary creation affordance.
- **Prevention rule:** When a page has duplicate empty-state and toolbar actions, POMs must scope to a stable region or intentionally select `.first()` with the UX rationale.
- **Files affected:** `apps/web/e2e/pages/WorkflowBuilderPage.ts`.

### 2026-05-30 INFRA: Service worker did not serve SPA routes offline

- **What went wrong:** Reloading `/dashboard` offline failed with `net::ERR_FAILED` even after the service worker registered.
- **Root cause:** The service worker cached `/` and `/index.html` but did not use an app-shell fallback for navigation requests like `/dashboard`.
- **Prevention rule:** PWA service workers for SPA routes must detect navigation requests and fall back to cached `/index.html` when the network is unavailable.
- **Files affected:** `apps/web/public/sw.js`.

### 2026-05-30 UX: Sales dashboard microcopy failed contrast

- **What went wrong:** Axe reported serious color contrast failures on tiny uppercase product-category labels in the sales dashboard table.
- **Root cause:** The label used tertiary text at 10px on a subtle blue row bar, below WCAG AA for normal text.
- **Prevention rule:** Text below 18px must use a token with proven 4.5:1 contrast, especially on colored or tinted table backgrounds.
- **Files affected:** `apps/web/src/pages/SalesDashboardPage.tsx`.

### 2026-05-30 TESTING: Custom object spec used broad text selector

- **What went wrong:** After the create flow rendered correctly, the spec still failed because `getByText(/objectName/i)` matched both the object label and the generated API key.
- **Root cause:** The assertion used page-wide text instead of the durable list item test id introduced for custom object cards.
- **Prevention rule:** For records that render both human labels and derived keys, assert against the row/card container or a role with a precise accessible name.
- **Files affected:** `apps/web/e2e/flows/custom-objects.spec.ts`.

### 2026-05-30 TESTING: Captured stale GET response after custom object create

- **What went wrong:** I added a post-create list response assertion, but the Playwright response predicate matched an earlier in-flight GET instead of the refetch caused by the create mutation.
- **Root cause:** The response predicate checked only method and URL, not whether the response was causally after the POST or contained the created object from the POST body.
- **Prevention rule:** E2E create-to-list assertions should derive the canonical selector from the mutation response and then assert the rendered item, not infer causality from a broad GET response matcher.
- **Files affected:** `apps/web/e2e/pages/CustomObjectsAdminPage.ts`.

### 2026-05-30 TOOLING: Ran direct Prisma inspection without loading API env

- **What went wrong:** I tried a direct Prisma inspection command from the API package, but `DATABASE_URL` was not loaded in that shell.
- **Root cause:** I assumed the E2E web server environment would carry into a separate `pnpm exec tsx` process.
- **Prevention rule:** Use existing API routes or app test harnesses for DB observations unless the shell explicitly loads the same env contract without printing secrets.
- **Files affected:** none.

### 2026-05-30 TESTING: Custom object create succeeded but list selector stayed stale

- **What went wrong:** After fixing the backend create path, the focused E2E still failed because the admin list did not visibly expose the created object before the assertion.
- **Root cause:** I verified the API mutation before proving the UI list contract and selector contract were aligned after cache invalidation.
- **Prevention rule:** For create-to-list flows, assert all three layers explicitly: mutation response, refetched list payload, and scoped visible list item.
- **Files affected:** `apps/web/e2e/pages/CustomObjectsAdminPage.ts`, `apps/web/src/hooks/useCustomObjects.ts`.

### 2026-05-30 TOOLING: Assumed Playwright artifacts were rooted at workspace

- **What went wrong:** I tried to read a Playwright `test-results` artifact from the repository root after a filtered web E2E run.
- **Root cause:** The filtered package command writes artifacts under `apps/web/test-results`, not the root-level path shown in condensed Playwright output.
- **Prevention rule:** Resolve package-scoped Playwright artifacts from the package directory before opening screenshots, traces, or error contexts.
- **Files affected:** none.

### 2026-05-30 TESTING: Custom object creation did not prove list persistence

- **What went wrong:** The custom object E2E flow clicked create and waited for the object name in the admin list, but the product path did not reliably surface the newly created object.
- **Root cause:** The creation flow returned to a UI state before proving the canonical list had refetched or rendered the new object.
- **Prevention rule:** Creation flows must wait on the API mutation and then render/refetch durable list state with a user-visible success affordance.
- **Files affected:** `apps/api/src/services/custom-object.helpers.ts`, `apps/api/src/services/custom-object.service.ts`, `apps/web/src/hooks/useCustomObjects.ts`, `apps/web/src/pages/CustomObjectsAdminPage.tsx`, `apps/web/e2e/pages/CustomObjectsAdminPage.ts`.

### 2026-05-30 TESTING: E2E helpers raced valid/invalid public states

- **What went wrong:** Focused E2E still failed after product fixes because the signing helper checked invalid-link state before the public request finished, and the lead helper fell through even though the conversion button rendered.
- **Root cause:** The POM contracts were less specific than the product UI: public signing needed to wait for terminal states, and lead conversion needed to target the actual conversion CTA instead of a broad regex that can collide with other controls.
- **Prevention rule:** E2E page objects must wait for a clear terminal state and use stable, scoped selectors for primary business actions.
- **Files affected:** `apps/web/e2e/pages/PublicSignPage.ts`, `apps/web/e2e/flows/lead-management.spec.ts`.

### 2026-05-30 TESTING: Full E2E run exhausted public exchange-rate rate limit

- **What went wrong:** Full `pnpm e2e` produced `/api/v1/exchange-rates` 429 responses that surfaced as page console errors and failed the account cockpit regression.
- **Root cause:** Every app-shell page could independently request exchange rates while the API capped the cached public endpoint at only 30 requests per minute per IP.
- **Prevention rule:** Shared app-shell data must dedupe client requests, keep safe fallbacks on transient failures, and use rate limits sized for multi-page browser sessions.
- **Files affected:** `apps/web/src/stores/currency.ts`, `apps/api/src/routes/exchange-rates.ts`.

### 2026-05-30 TOOLING: Worker root typecheck replayed stale incremental diagnostics

- **What went wrong:** Root `pnpm typecheck` reported missing Dust symbols that were no longer present in the current worker source, while direct worker typecheck passed.
- **Root cause:** The worker package inherited `"incremental": true` from the base TypeScript config, leaving root recursive typecheck vulnerable to stale `.tsbuildinfo` diagnostics after rapid queue-file edits.
- **Prevention rule:** Release-gate typecheck scripts for fragile worker packages should run non-incrementally; builds may stay incremental, but validation must read current source.
- **Files affected:** `apps/worker/package.json`, `docs/solutions/production-gate-noise.md`.

### 2026-05-30 TESTING: RFP extractor helper exported stale Dust API

- **What went wrong:** Root `pnpm typecheck` failed because `rfp-requirement-extract.helpers.ts` referenced `DustClient` without importing it and `rfp-requirement-extract.processor.ts` imported a stale `DUST_AGENT_ID` export.
- **Root cause:** The RFP extractor files were left between the old global Dust-client pattern and the newer org-scoped credential pattern used by section draft, compliance, legal scan, and QA review workers.
- **Prevention rule:** RFP worker Dust migrations must be done by queue family, not one file at a time; helper exports and processor imports need to be verified together under root `pnpm typecheck`.
- **Files affected:** `apps/worker/src/queues/rfp-requirement-extract.helpers.ts`, `apps/worker/src/queues/rfp-requirement-extract.processor.ts`.

### 2026-05-30 TESTING: Root typecheck caught compliance-fill Dust constant drift

- **What went wrong:** Root `pnpm typecheck` failed because `apps/worker/src/queues/rfp-compliance-fill.ts` referenced `DUST_AGENT_ID` without a valid module-level definition.
- **Root cause:** The compliance-fill worker was partially migrated toward org-scoped Dust credentials but still used an old global constant name in the call path.
- **Prevention rule:** When migrating RFP workers to per-org Dust credentials, replace both client creation and agent-id resolution in the same patch, then verify with the root typecheck gate.
- **Files affected:** `apps/worker/src/queues/rfp-compliance-fill.ts`.

### 2026-05-30 TESTING: Worker legal scan lost Dust symbols

- **What went wrong:** `pnpm typecheck` failed because `apps/worker/src/queues/rfp-legal-scan.ts` referenced `getDustClient` and `DUST_AGENT_ID` without importing or defining them.
- **Root cause:** The worker legal-scan implementation depended on Dust integration symbols that were not wired in the module, and the earlier gate pass happened before the dependency sync exposed the current compile state.
- **Prevention rule:** When adding or modifying worker queues, run package-level and root typecheck immediately, and read existing Dust client helper patterns before referencing shared integration symbols.
- **Files affected:** `apps/worker/src/queues/rfp-legal-scan.ts`.

### 2026-05-30 SECURITY: Dependency audit blocked on transitive tmp advisory

- **What went wrong:** `pnpm audit --audit-level high` failed because tooling packages pulled `tmp@0.2.5`, which is affected by GHSA-ph9p-34f9-6g65.
- **Root cause:** Existing pnpm overrides covered several advisories but did not pin the vulnerable `tmp` transitive dependency to the patched release.
- **Prevention rule:** After every dependency-audit fix, rerun the audit and keep security overrides current for transitive tooling dependencies that upstream packages have not yet bumped.
- **Files affected:** `package.json`, `pnpm-lock.yaml`.

### 2026-05-30 TOOLING: Did not strip lifecycle env for worker Vitest

- **What went wrong:** Direct Node/Vitest worked from a normal shell, but the same command failed when launched by `pnpm test` because lifecycle env vars were still inherited.
- **Root cause:** I changed the command path but not the child process environment, so the worker test still ran inside pnpm's lifecycle context.
- **Prevention rule:** For fragile process-pool gates, use a dedicated runner script that spawns the test process with a deliberately filtered environment.
- **Files affected:** `scripts/run-worker-tests.mjs`, `apps/worker/package.json`, `package.json`.

### 2026-05-30 TOOLING: Let pnpm lifecycle launch the fragile worker Vitest binary

- **What went wrong:** The worker test still failed under `pnpm test` even with explicit Vitest flags, while direct `node node_modules/vitest/vitest.mjs ...` passed.
- **Root cause:** The remaining instability was in the package-manager lifecycle wrapper around the Vitest binary, not the assertions or the chosen pool mode.
- **Prevention rule:** For fragile Windows process-pool gates, launch the local tool entrypoint with `node` directly from the package script and keep the exact flags visible.
- **Files affected:** `apps/worker/package.json`.

### 2026-05-30 TOOLING: Assumed Vitest was hoisted at the workspace root

- **What went wrong:** I tried to inspect `node_modules/vitest`, but this pnpm workspace does not expose Vitest at the root path.
- **Root cause:** I forgot pnpm keeps package executables/dependencies linked per workspace package unless explicitly hoisted.
- **Prevention rule:** Inspect `apps/<package>/node_modules` or use `pnpm --dir <package> exec` when resolving package-local tooling.
- **Files affected:** none; inspection command only.

### 2026-05-30 TOOLING: Relied on worker Vitest config for critical pool flags

- **What went wrong:** `pool: 'vmThreads'` in `apps/worker/vitest.config.ts` still produced a blank failing package script, while passing the same pool flags explicitly on the Vitest CLI succeeded.
- **Root cause:** The critical runner settings were hidden behind config-loader behavior; the package script did not make the intended pool mode observable at the command line.
- **Prevention rule:** Put fragile release-gate runner flags directly in the package script, even if they are also represented in config, so root logs show the actual execution mode.
- **Files affected:** `apps/worker/package.json`.

### 2026-05-30 TOOLING: Kept chasing fork-pool mitigations after IPC stayed flaky

- **What went wrong:** Serial fork modes still intermittently failed with Tinypool `ERR_IPC_CHANNEL_CLOSED`; even direct package-directory runs could fail after prior fork failures.
- **Root cause:** The core instability was the child-process fork channel itself, not only pnpm recursion, file parallelism, or test ordering.
- **Prevention rule:** When an error is in the pool transport layer, validate a different transport (`vmThreads`) instead of stacking more mitigations onto the same failing transport.
- **Files affected:** `apps/worker/vitest.config.ts`.

### 2026-05-30 TOOLING: Used pnpm filter run for worker tests

- **What went wrong:** `pnpm --filter @bidstack/worker test` failed with Tinypool `ERR_IPC_CHANNEL_CLOSED`, while `pnpm test` from `apps/worker` passed.
- **Root cause:** `pnpm --filter ... test` still uses pnpm's recursive run wrapper, which is fragile for this worker/Vitest/fork-pool package on Windows.
- **Prevention rule:** For root scripts that need this worker package, invoke it with `pnpm --dir apps/worker test` or direct `exec`, not filtered recursive run.
- **Files affected:** `package.json`.

### 2026-05-30 TOOLING: Left worker Vitest file isolation enabled

- **What went wrong:** The root test gate still hit `ERR_IPC_CHANNEL_CLOSED` after moving worker tests earlier and disabling file parallelism.
- **Root cause:** Vitest was still creating isolated fork workers per file; removing parallelism reduced concurrency but did not remove fork churn.
- **Prevention rule:** For packages with queue/process-pool tests on Windows, stabilize both dimensions: disable file parallelism and disable per-file isolation, then verify with repeated package and root runs.
- **Files affected:** `apps/worker/vitest.config.ts`.

### 2026-05-30 TOOLING: Assumed the i18n module filename

- **What went wrong:** I tried to open `apps/web/src/i18n/i18n.ts`, but the i18n singleton lives in `apps/web/src/i18n/index.ts`.
- **Root cause:** I inferred the module path from the test filename instead of using the search results first.
- **Prevention rule:** When a directory has an `index.ts`, inspect exports/search results before opening a guessed sibling filename.
- **Files affected:** none; inspection command only.

### 2026-05-30 TOOLING: Ran worker tests after API in the same root shell

- **What went wrong:** Even after removing the worker from pnpm recursive streaming, `pnpm test` still failed when the root script launched worker tests after the heavy API suite in the same shell chain.
- **Root cause:** The worker's fork-based Vitest pool is sensitive to inherited process state/resource pressure after the API test suite; the package test is stable when launched before API or as an isolated command.
- **Prevention rule:** Run worker/queue packages that own process pools before heavy API/browser suites in aggregate release scripts, and document ordering as part of the gate contract.
- **Files affected:** `package.json`.

### 2026-05-30 TOOLING: Assumed package-local worker pass solved recursive root runner

- **What went wrong:** After stabilizing `pnpm --filter @bidstack/worker test`, the root `pnpm test` still failed when pnpm launched the worker through the recursive `-r --stream` wrapper after the API package.
- **Root cause:** I fixed Vitest's per-package parallelism but left the more fragile pnpm recursive wrapper path in the release gate.
- **Prevention rule:** When a gate fails only under the aggregate runner, verify both the package script and the aggregate orchestration; isolate fragile packages out of recursive streaming if they own child processes or worker pools.
- **Files affected:** `package.json`, `apps/worker/vitest.config.ts`.

### 2026-05-30 TOOLING: Trusted one worker thread-pool pass before default-script verification

- **What went wrong:** I changed the worker Vitest pool to `threads` after a direct CLI pass, but the default package script then crashed on Windows with exit `3221225477`.
- **Root cause:** I treated one alternate-command pass as enough evidence for a persistent runner config, before verifying the actual package script users and CI run.
- **Prevention rule:** Runner/config changes must be validated through the package's default script before considering them viable; direct override commands are only probes.
- **Files affected:** `apps/worker/vitest.config.ts`, `docs/solutions/production-gate-noise.md`.

### 2026-05-30 INFRA: Worker Vitest fork pool closed IPC channel after passing tests

- **What went wrong:** The worker package tests passed their assertions but the release gate still failed with Tinypool `ERR_IPC_CHANNEL_CLOSED` during process-pool shutdown.
- **Root cause:** The worker Vitest config used the `forks` pool, which is more fragile on this Node/Vitest combination than the thread pool even though document extraction tests spawn their own `worker_threads`.
- **Prevention rule:** Prefer a proven runner mode over a theoretical isolation mode; if a package needs sandbox worker coverage, verify the full package under the chosen Vitest pool and document why.
- **Files affected:** `apps/worker/vitest.config.ts`.

### 2026-05-30 TOOLING: Let fastify-plugin erase typed options

- **What went wrong:** I added a typed cache plugin option but wrapped the inline function with `fp(...)` in a way that TypeScript inferred `Record<never, never>`, breaking `pnpm --filter @bidstack/api typecheck`.
- **Root cause:** I assumed the `FastifyPluginAsync<Options>` annotation on an inline exported const would survive the `fastify-plugin` wrapper inference.
- **Prevention rule:** For Fastify plugins with options, type the implementation function first, then wrap/export it with `fp(...)` so plugin options remain visible to TypeScript.
- **Files affected:** `apps/api/src/plugins/redis-cache.ts`.

### 2026-05-30 TOOLING: Passed Playwright grep through the root script incorrectly

- **What went wrong:** I ran `pnpm e2e --grep @bundle`, which the root script forwarded as `playwright test "--grep"` without the grep value, causing Playwright to fail argument parsing.
- **Root cause:** I forgot that pnpm script argument forwarding around options needs an explicit separator or a direct filtered command.
- **Prevention rule:** For Playwright options, prefer `pnpm --filter @bidstack/web exec playwright test --grep "<tag>"` so option values are preserved.
- **Files affected:** none; verification command only.

### 2026-05-30 TOOLING: PowerShell split an `rg` alternation pattern

- **What went wrong:** A multi-alternation `rg` command for frontend imports was parsed by PowerShell as multiple arguments and paths, producing file/path errors instead of search results.
- **Root cause:** I used shell-sensitive quoting for a complex regex instead of either single-quoting the whole pattern carefully or running smaller searches.
- **Prevention rule:** On Windows, keep `rg` regexes simple or run several narrow searches; avoid mixed quote/pipe patterns that PowerShell can reinterpret.
- **Files affected:** none; inspection command only.

### 2026-05-30 TOOLING: Assumed Vite manifest path existed

- **What went wrong:** I tried to read `apps/web/dist/.vite/manifest.json`, but the current Vite build does not emit a `.vite` manifest.
- **Root cause:** I trusted the optional path mentioned in the bundle-budget test before checking whether `build.manifest` is enabled.
- **Prevention rule:** Check filesystem output before opening optional build artifacts; when absent, use the test's fallback path or inspect `dist/assets`.
- **Files affected:** none; inspection command only.

### 2026-05-30 TOOLING: Assumed logger test filename existed

- **What went wrong:** I tried to read `apps/api/src/lib/logger.test.ts`, but this workspace did not have a logger-specific test file yet.
- **Root cause:** I inferred a natural test filename from the module path instead of discovering existing test coverage with `rg` first.
- **Prevention rule:** Search for existing tests before opening assumed filenames; if no test exists, create one intentionally after inspecting local test conventions.
- **Files affected:** none; inspection command only.

### 2026-05-30 BUG: Cache invalidation happened after mutation responses

- **What went wrong:** A mutation followed immediately by a read could still receive stale cached data because the cache plugin invalidated in `onResponse`, after Fastify had already completed the response lifecycle visible to the caller.
- **Root cause:** I treated `onResponse` as a safe invalidation point for read-after-write behavior instead of using a pre-send hook.
- **Prevention rule:** Cache invalidation that protects read-after-write consistency must happen before the mutation response is released, such as in `onSend`, not in post-response cleanup.
- **Files affected:** `apps/api/src/plugins/redis-cache.ts`, `apps/api/src/plugins/redis-cache.test.ts`.

### 2026-05-30 TESTING: Cache invalidation test assigned auth too late

- **What went wrong:** The cache invalidation regression still failed after the helper fix because the test assigned `req.auth` inside route handlers, while the cache plugin invalidation hook reads auth from the normal pre-handler lifecycle.
- **Root cause:** The test stub did not mirror production auth timing, where the auth plugin decorates the request before protected route handlers run.
- **Prevention rule:** Tests for hooks that inspect request auth must assign auth in `preHandler` or use `buildServer`; assigning auth inside the route only validates handler-local behavior.
- **Files affected:** `apps/api/src/plugins/redis-cache.test.ts`.

### 2026-05-30 BUG: Cache invalidation trusted only the Redis branch

- **What went wrong:** The concurrent-cache test pass exposed that `cacheDel` could leave stale fallback in-memory entries when Redis was considered connectable but the cached value had been written to the fallback map.
- **Root cause:** `cacheDel` returned after the Redis `KEYS/DEL` path and did not always clear the process-local fallback cache.
- **Prevention rule:** Multi-layer cache invalidation must clear every layer every time; optimized external cache paths must not short-circuit local fallback cleanup.
- **Files affected:** `apps/api/src/lib/redis-cache.ts`, `apps/api/src/plugins/redis-cache.test.ts`.

### 2026-05-30 TOOLING: Assumed collaboration test filename existed

- **What went wrong:** I tried to read `apps/api/src/routes/collaboration.test.ts`, but that test file does not exist in this workspace.
- **Root cause:** I inferred a conventional route test filename instead of using `rg` first to discover actual coverage.
- **Prevention rule:** Before opening an assumed test filename, search for the route or endpoint string with `rg` and then read the discovered files.
- **Files affected:** none; inspection command only.

### 2026-05-25 UX: Local CRM was allowed to render while auth mode emitted Clerk-key errors

- **What went wrong:** A bare `vite` local server could show CRM pages while the browser console still recorded `VITE_CLERK_PUBLISHABLE_KEY` auth failures, making the app look functional but poisoning QA signal.
- **Root cause:** The runtime auth guard mixed production fail-closed behavior with local stub fallback, while the real production guarantee already belongs in the Vite production build gate.
- **Prevention rule:** Keep runtime auth mode explicit: `VITE_AUTH_MODE=clerk` requires a Clerk key, while local/stub execution must remain deterministic and quiet. Verify served source and page state when browser console history is sticky.
- **Files affected:** `apps/web/src/lib/auth.tsx`, `apps/web/src/main.tsx`.

### 2026-05-25 TESTING: RFP extraction test over-claimed critical risk

- **What went wrong:** The new worker test expected `must provide SOC 2 Type II evidence` to classify as `critical`, but the implemented classifier correctly treats ordinary mandatory/security evidence as `high` unless it also carries hard-disqualifier, deadline, breach, or privacy language.
- **Root cause:** I wrote the assertion before aligning the test with the risk rubric encoded in `requirementPriority`.
- **Prevention rule:** When adding tests for heuristics, first name the rubric boundaries in the assertion and reserve `critical` for explicit critical signals, not every mandatory requirement.
- **Files affected:** `apps/worker/src/queues/document-extract.test.ts`.

### 2026-05-22 SECURITY: Invoice lines validated product IDs too late

- **What went wrong:** `POST /api/invoices` accepted a line item `productId` from another tenant and only failed when Prisma hit the invoice-line foreign key, returning a generic 400/500-shaped persistence failure instead of a tenant-aware 404.
- **Root cause:** The invoice route trusted nested relation IDs while building `lines.create` and did not reuse the shared tenant-ownership guard before writing.
- **Prevention rule:** Every mutation that accepts related IDs must validate those IDs by `{ id, orgId }` before persistence; nested Prisma writes are never the first tenant boundary.
- **Files affected:** `apps/api/src/routes/invoices.ts`.

### 2026-05-19 TESTING: Ran preview E2E before rebuilding dist

- **What went wrong:** After changing `CommandPalette.tsx`, I reran Playwright preview E2E without rebuilding `apps/web/dist`, so the test executed the stale bundle and repeated the same failure.
- **Root cause:** I forgot this repo's E2E script uses `vite preview`, not the dev server, when `E2E_BASE_URL` is unset.
- **Prevention rule:** After frontend code changes, run `pnpm --filter @bidstack/web build` before preview-backed E2E, or point E2E at an active dev server intentionally.
- **Files affected:** none; verification command only.

### 2026-05-19 TESTING: Passed unsupported Vitest flag

- **What went wrong:** I ran `pnpm --filter @bidstack/web test -- --runInBand`; this Vitest version does not support Jest's `--runInBand` flag, so the test command failed before running tests.
- **Root cause:** I reused a Jest flag instead of the repo's documented `pnpm test`/Vitest command shape.
- **Prevention rule:** For this repo, run `pnpm --filter @bidstack/web test` directly unless a Vitest-supported flag has been confirmed locally.
- **Files affected:** none; verification command only.

### 2026-05-19 TOOLING: MobileNav patch included shell-rendered mojibake

- **What went wrong:** I included the terminal-rendered `BidStackÂ°` line inside a large `apply_patch`, so the patch could not match the actual Unicode source.
- **Root cause:** I repeated the already logged Unicode-console mistake while changing a surrounding block.
- **Prevention rule:** When a file has known mojibake in shell output, keep patches away from those lines unless a byte-safe read has confirmed the exact text.
- **Files affected:** none.

### 2026-05-19 TOOLING: Repeated mojibake patch attempt on DataQualitySection

- **What went wrong:** I tried to patch a terminal-rendered mojibake line in `DataQualitySection.tsx`, repeating the same Unicode-console failure pattern already logged.
- **Root cause:** I acted on the shell rendering instead of first reading the exact file text or bytes around the target line.
- **Prevention rule:** For any file that renders non-ASCII incorrectly in PowerShell, inspect the target line through JSON/byte-safe tooling before `apply_patch`; patch against ASCII-only surrounding structure or replace a bounded helper block.
- **Files affected:** none.

### 2026-05-19 TOOLING: Browser click timed out on New company

- **What went wrong:** The in-app browser timed out while clicking the `New company` button during smoke verification, even though the button was present in the DOM.
- **Root cause:** The browser automation bridge timed out on a CDP evaluation/click path in a motion-heavy app view.
- **Prevention rule:** After one in-app click timeout, stop retrying the same click path; use DOM assertions and the repo Playwright E2E runner for interaction coverage.
- **Files affected:** none; verification tooling only.

### 2026-05-19 TOOLING: Preview server start did not bind on 4184

- **What went wrong:** I launched a hidden Vite preview process on port 4184, but the follow-up probe could not connect.
- **Root cause:** The background process failed or exited before binding, and I did not capture its stderr/stdout.
- **Prevention rule:** When starting a new preview server for verification, either probe an already-running known-good preview after rebuilding `dist` or launch with redirected logs so failures are diagnosable.
- **Files affected:** none; verification tooling only.

### 2026-05-19 TOOLING: Repeated PowerShell chaining after prevention

- **What went wrong:** I used `&&` again immediately after logging that PowerShell command chaining mistake.
- **Root cause:** I reused a shell command pattern from memory instead of applying the just-written prevention rule.
- **Prevention rule:** Do not write compound shell commands manually for the rest of this turn. Use `multi_tool_use.parallel` for independent reads and a single command per shell call for everything else.
- **Files affected:** none; inspection command only.

### 2026-05-19 TOOLING: Repeated Bash-style command chaining in PowerShell

- **What went wrong:** I used `&&` while combining a file read and ripgrep inspection in PowerShell, which this shell context rejects.
- **Root cause:** I rushed an inspection command and repeated an already-logged shell syntax mistake.
- **Prevention rule:** Run dependent PowerShell inspections as separate tool calls or use `multi_tool_use.parallel` for independent reads; do not chain commands with `&&` in this workspace.
- **Files affected:** none; inspection command only.

### 2026-05-19 TOOLING: Mojibake copy patch failed in data quality

- **What went wrong:** A targeted patch for the data-quality empty-state copy failed because the existing message line contains terminal-rendered mojibake punctuation.
- **Root cause:** I repeated the provider-health patch pattern too soon and included rendered non-ASCII punctuation in the expected context.
- **Prevention rule:** For the rest of this session, do not patch copy lines containing mojibake directly; replace a wider ASCII-bounded component block or leave the copy for a later verified encoding pass.
- **Files affected:** none; patch did not apply.

### 2026-05-19 TOOLING: Subagent repeated leading-dash rg search

- **What went wrong:** The Dev Agent reported hitting an already-logged `rg` leading-dash pattern mistake during inspection.
- **Root cause:** The subagent did not apply the existing prevention rule for CSS custom-property searches.
- **Prevention rule:** All agents inspecting CSS variables must use `rg -F -- "--token-name" path` and must keep this rule in their task prompt when CSS/token searches are likely.
- **Files affected:** none; inspection command only.

### 2026-05-19 TOOLING: Mojibake caption patch failed in provider health

- **What went wrong:** A targeted patch for `ProviderHealthSection.tsx` failed because the exact caption lines contain terminal-rendered mojibake characters and did not match the source bytes.
- **Root cause:** I copied rendered text from PowerShell output instead of anchoring the patch only on stable ASCII structure.
- **Prevention rule:** In files with mojibake display text, patch around ASCII-only identifiers or use a small helper insertion plus minimal structural replacement; do not include rendered punctuation in patch context.
- **Files affected:** none; patch did not apply.

### 2026-05-18 TOOLING: Repeated wildcard positional test search

- **What went wrong:** I passed `apps/web/src/**/*.test.ts` and `apps/web/src/**/*.test.tsx` as positional paths to `rg`, which fails on this PowerShell/Windows path shape.
- **Root cause:** I repeated the already-logged wildcard path mistake while quickly checking whether preferences tests existed.
- **Prevention rule:** For the remainder of this session, run `rg` from the repo root with `-g` include globs or concrete directories only; never pass wildcard filesystem paths as positional arguments.
- **Files affected:** none; inspection command only.

### 2026-05-18 TOOLING: CSS variable search parsed as rg flag

- **What went wrong:** I searched for `--border-focus` with `rg -F` but did not pass `--` before the pattern, so ripgrep treated the CSS variable as a command flag.
- **Root cause:** I forgot that leading-dash literals need an end-of-options marker even with fixed-string search.
- **Prevention rule:** When searching for CSS custom properties with `rg`, use `rg -F -- "--token-name" path`.
- **Files affected:** none; inspection command only.

### 2026-05-18 TOOLING: Double-quote literal search failed in PowerShell

- **What went wrong:** I tried a simple literal `rg` search for double-quoted `api(\"/` calls, but the PowerShell command string still parsed with an unterminated quote.
- **Root cause:** I mixed JSON escaping with PowerShell quoting after already deciding to avoid fragile quoted searches.
- **Prevention rule:** Do not search for double-quote code literals with shell quoting in this session; rely on single-quote literal searches, file reads, or TypeScript validation instead.
- **Files affected:** none; inspection command only.

### 2026-05-18 TOOLING: Repeated quoted regex search failed again

- **What went wrong:** I tried to search for non-`/api` API paths with a quoted regex lookahead, and PowerShell parsed the quote incorrectly before `rg` could run.
- **Root cause:** I ignored the freshly logged prevention rule and used another complex regex in PowerShell.
- **Prevention rule:** Do not run any more quoted regex lookahead searches in PowerShell this session; use simple `rg -F`, file-specific reads, or a small Node/Python-free shell-safe inspection only when needed.
- **Files affected:** none; inspection command only.

### 2026-05-18 TOOLING: Repeated complex rg pattern broke in PowerShell

- **What went wrong:** I ran an `rg` alternation containing escaped quotes for motion CSS checks, and the regex parser failed with an unclosed group.
- **Root cause:** I repeated the already-logged habit of packing too many quoted alternatives into one PowerShell search.
- **Prevention rule:** For the rest of this session, use simple literal `rg -F` searches or separate commands for CSS selectors and media queries.
- **Files affected:** none; inspection command only.

### 2026-05-18 TOOLING: Repeated PowerShell wildcard path passed to rg

- **What went wrong:** I ran `rg` with `apps\web\src\*.tsx` as a positional path, which PowerShell/ripgrep treated as an invalid literal path.
- **Root cause:** I repeated an already-logged Windows glob mistake while trying to broaden an API/auth usage search quickly.
- **Prevention rule:** For the rest of this session, run `rg` from the repository root with `-g` include globs only; never pass wildcard filesystem paths as positional arguments in PowerShell.
- **Files affected:** none; inspection command only.

### 2026-05-17 TESTING: Dashboard test treated customer stage as open

- **What went wrong:** The dashboard account-scoping test computed expected open deals from serialized CRM stages and counted `customer` as open, but `customer` is the current serialized label for raw `closed_won`.
- **Root cause:** I used the UI-facing deal stage labels without checking `mapDealStage` semantics.
- **Prevention rule:** When deriving assertions from serialized stage labels, confirm the stage mapping and explicitly classify terminal/customer stages.
- **Files affected:** `apps/api/src/routes/crm/dashboard.test.ts`.

### 2026-05-17 BUG: Cockpit account test exposed exact-name matching drift

- **What went wrong:** The new dashboard account-scoping regression test failed because `buildCockpit` matched opportunities by exact `opp.customer === company.name`, while serialized deals/company ids use normalized names.
- **Root cause:** The route fix correctly passed account id into the service, but the service still depended on fragile display-name equality inside the cockpit builder.
- **Prevention rule:** Account-level dashboard joins must use a shared normalized-company matcher, not raw display-name equality.
- **Files affected:** `apps/api/src/services/crm/dashboard.service.ts`, `apps/api/src/routes/crm/dashboard.test.ts`.

### 2026-05-17 TOOLING: Playwright smoke targeted a stopped dev port

- **What went wrong:** External Playwright tried `http://127.0.0.1:5173/sales/products` and hit `ERR_CONNECTION_REFUSED`.
- **Root cause:** I assumed the previous web server on 5173 was still alive after longer work and in-app browser failures.
- **Prevention rule:** Before browser smoke, probe the candidate dev URLs and use the responding port; start/restart the web server only after confirming no current server is available.
- **Files affected:** none; browser verification only.

### 2026-05-17 TOOLING: In-app browser blocked localhost navigation

- **What went wrong:** Browser QA attempted to open `http://127.0.0.1:5173/sales/products`, but the in-app browser reported `net::ERR_BLOCKED_BY_CLIENT`.
- **Root cause:** I targeted a local URL/port without first confirming which in-app tab URL was currently allowed by the browser profile.
- **Prevention rule:** For in-app browser QA, start from the selected tab/current dev URL when available, or retry once with `localhost`/the active port before falling back to repository Playwright.
- **Files affected:** none; browser verification only.

### 2026-05-17 PROCESS: Repeated broad patching around mojibake table text

- **What went wrong:** After logging that broad patches around mojibake display text are brittle, I repeated the mistake on `SalesOrdersPage.tsx`, and the patch failed.
- **Root cause:** I tried to convert too much table structure in one pass instead of applying the logged prevention rule immediately.
- **Prevention rule:** Halt broad UI table rewrites in mojibake-affected files; only patch imports/actions first, then use tiny ASCII-only row/table tag hunks.
- **Files affected:** none; patch did not apply.

### 2026-05-17 TOOLING: Broad Products page patch matched mojibake text

- **What went wrong:** A multi-hunk patch for `ProductsPage.tsx` failed because one hunk matched table text containing mojibake characters.
- **Root cause:** I included too much surrounding display text in the patch context instead of anchoring on stable ASCII identifiers.
- **Prevention rule:** In files with corrupted/non-ASCII display text, patch imports and structural JSX in smaller ASCII-only hunks.
- **Files affected:** none; patch did not apply.

### 2026-05-17 TOOLING: Assumed a web test setup filename existed

- **What went wrong:** I tried to read `apps/web/src/test/setup.ts`, which does not exist in this workspace.
- **Root cause:** I inferred a conventional Vitest setup path instead of checking `apps/web/vitest.config.ts` first.
- **Prevention rule:** Inspect the package test config before opening assumed setup files.
- **Files affected:** none; inspection command only.

### 2026-05-17 BUG: Quantity parser allowed an undefined whole part

- **What went wrong:** API typecheck failed because `parseQuantityThousandths` destructured `quantity.split('.')` and passed a possibly undefined `whole` value to `BigInt`.
- **Root cause:** I relied on the shared Zod regex invariant but did not encode the invariant for TypeScript's control-flow analysis.
- **Prevention rule:** When converting validated strings to numeric primitives, still provide explicit fallback/default branches so TypeScript and runtime behavior agree.
- **Files affected:** `apps/api/src/routes/sales-orders.ts`.

### 2026-05-17 TOOLING: Guessed a sales page filename during inspection

- **What went wrong:** I tried to read `apps/web/src/pages/SalesPage.tsx`, but the file does not exist in this repo.
- **Root cause:** I inferred a route component filename from the route label instead of listing page files first.
- **Prevention rule:** Use `rg --files apps/web/src/pages` before opening a page file when the filename has not already been confirmed.
- **Files affected:** none; inspection command only.

### 2026-05-17 TOOLING: Bad PowerShell quoting in a broad rg inspection

- **What went wrong:** A broad `rg` command had an unterminated quoted pattern in PowerShell and failed before returning results.
- **Root cause:** I mixed many quoted alternatives into one command instead of splitting independent inspections.
- **Prevention rule:** Keep PowerShell `rg` patterns simple; when searching many CSS selectors, run separate `rg` calls or use a single-quoted pattern.
- **Files affected:** none; inspection command only.

### 2026-05-17 PROCESS: Tried to spawn all enterprise review squads at once

- **What went wrong:** I attempted to launch the orchestrator plus every section squad in one parallel batch, and the collaboration tool rejected most of them because the active agent thread limit was reached.
- **Root cause:** I optimized for the user's requested breadth before checking the platform's concurrency ceiling.
- **Prevention rule:** For large multi-section reviews, spawn the first wave only, wait or close completed agents, then continue section squads in controlled batches.
- **Files affected:** none; orchestration only.

### 2026-05-17 TOOLING: Used Bash-style `&&` in PowerShell

- **What went wrong:** I chained validation commands with `&&`, which PowerShell rejected as an invalid statement separator in this shell context.
- **Root cause:** I slipped into Bash syntax after several validation commands instead of using separate tool calls.
- **Prevention rule:** In this repo's PowerShell shell, run dependent commands as separate tool calls, or use native PowerShell syntax only when a single command truly needs sequencing.
- **Files affected:** none; validation command only.

### 2026-05-17 PROCESS: Used shell write for a one-line JSX replacement

- **What went wrong:** I used PowerShell `Set-Content` for a small Sidebar text replacement instead of `apply_patch`.
- **Root cause:** The patch matcher struggled with a mojibake degree symbol and I reached for a broad shell rewrite too quickly.
- **Prevention rule:** If `apply_patch` cannot match a non-ASCII line, patch a smaller ASCII-only surrounding hunk or leave the harmless text for a later formatting pass; do not use shell writes for manual edits.
- **Files affected:** `apps/web/src/components/layout/Sidebar.tsx`.

### 2026-05-17 TOOLING: Dotenv helper ran from the wrong package context

- **What went wrong:** An inline Prisma inspection script tried to import `dotenv-flow` from the repo root, where that dependency is not resolvable, then Prisma ran without `DATABASE_URL`.
- **Root cause:** I forgot the API loads dotenv from `apps/api` while the monorepo root does not expose `dotenv-flow` as a root dependency.
- **Prevention rule:** For ad-hoc Prisma scripts, run through the API package runtime and explicitly call `dotenvFlow.config({ path: 'D:/BIDCRM', silent: true })` before importing `@bidstack/db`.
- **Files affected:** none; inspection command only.

### 2026-05-17 PROCESS: Forked subagent options conflicted

- **What went wrong:** I tried to spawn a forked subagent while also overriding the agent type, which the tool rejected because full-history forks inherit the parent agent shape.
- **Root cause:** I mixed two valid subagent modes instead of using a self-contained non-forked worker prompt for the requested three-agent lane.
- **Prevention rule:** When using `fork_context: true`, omit `agent_type`, `model`, and `reasoning_effort`; when a specific role is needed, spawn without a full-history fork and provide self-contained task context.
- **Files affected:** none.

### 2026-05-18 SHELL: PowerShell pattern with embedded quotes failed again

- **What went wrong:** I ran `Select-String` with a pattern containing escaped double quotes, and PowerShell parsed it as an unterminated string.
- **Root cause:** I used shell-style escaping reflexively instead of single-quoting the whole PowerShell pattern.
- **Prevention rule:** For `Select-String -Pattern` values that include quotes or punctuation, wrap the entire pattern in single quotes or run separate simple searches.
- **Files affected:** none.

### 2026-05-12 TESTING: Ambiguous close button in meeting-import E2E

- **What went wrong:** The new account E2E clicked `getByRole('button', { name: 'Close' })` inside the meeting import dialog, but Radix also renders an icon-only close button with the same accessible name.
- **Root cause:** I added a dialog assertion without checking for duplicate accessible names in the modal header and footer.
- **Prevention rule:** In dialog E2E tests, close via exact visible text (`getByText('Close', { exact: true })`) or a more specific footer container when the header has an aria-label close control.
- **Files affected:** `apps/web/e2e/accounts.spec.ts`.

### 2026-05-12 TOOLING: External smoke script imported wrong Playwright package

- **What went wrong:** I wrote an inline smoke script with `require('playwright')`, but this workspace exposes Playwright through `@playwright/test`.
- **Root cause:** I used the generic Playwright package name instead of checking the package already used by the repo's E2E tests.
- **Prevention rule:** For ad-hoc browser smoke in this repo, import `chromium` from `@playwright/test` or run the existing `pnpm --filter @bidstack/web e2e` command.
- **Files affected:** none; validation script only.

### 2026-05-12 TOOLING: In-app browser selector timed out after screenshot failures

- **What went wrong:** After repeated screenshot capture timeouts, a normal in-app browser locator for the `New account` button also timed out during selector evaluation.
- **Root cause:** The browser automation bridge was degraded after the CDP screenshot timeouts, even though prior DOM checks had already validated the rendered cockpit.
- **Prevention rule:** If screenshot capture timeouts are followed by selector-evaluation timeouts, stop using the in-app bridge for that pass and switch to the repo Playwright runtime for browser smoke.
- **Files affected:** none; validation tooling only.

### 2026-05-12 TOOLING: Browser visible-screen capture also used timed-out screenshot path

- **What went wrong:** I switched from Playwright screenshot to the browser visible-screen capture path, but it still timed out through the same underlying screenshot command.
- **Root cause:** The available screenshot methods share a CDP capture dependency in this environment.
- **Prevention rule:** When both Playwright and visible-screen capture time out, stop retrying in-app screenshots and use external Playwright CLI or DOM/console validation instead.
- **Files affected:** none; validation artifact capture only.

### 2026-05-12 TOOLING: Viewport screenshot used same timed-out CDP capture path

- **What went wrong:** After the full-page screenshot timeout, I retried with `fullPage: false`, but it still used the same CDP screenshot path and timed out again.
- **Root cause:** I assumed viewport capture would use a lighter transport; in this browser bridge it still depends on `Page.captureScreenshot`.
- **Prevention rule:** If `Page.captureScreenshot` times out once on the dense cockpit, do not retry the Playwright screenshot API in the same smoke pass; use DOM/console checks or the browser visible-screen capture path.
- **Files affected:** none; validation artifact capture only.

### 2026-05-12 TOOLING: Full-page browser screenshot timed out on dense cockpit

- **What went wrong:** I attempted a full-page in-app browser screenshot of the motion-heavy cockpit and the browser bridge timed out on `Page.captureScreenshot`.
- **Root cause:** The page is tall and animation-rich; full-page capture is heavier than needed for a visual smoke artifact.
- **Prevention rule:** For dense animated cockpit QA, capture the visible viewport first; only use full-page screenshots when the viewport artifact is insufficient.
- **Files affected:** none; validation artifact capture only.

### 2026-05-12 TESTING: E2E run skipped after API was stopped for typecheck

- **What went wrong:** I ran `pnpm e2e` immediately after stopping the API for the root Prisma/typecheck gate, so Playwright's API health preflight failed and all tests were skipped.
- **Root cause:** I treated the typecheck stop/restart protocol as complete before actually restarting the API.
- **Prevention rule:** After any validation step that stops the API, restart the API and verify `/health` before running E2E; skipped Playwright tests are never a green gate.
- **Files affected:** none; validation sequencing only.

### 2026-05-12 INFRA: Profile-gated Odoo required env blocked Redis-only compose start

- **What went wrong:** After adding a transient Postgres password, `docker compose up -d redis` still failed because the profile-gated Odoo MCP service has required env placeholders that Compose interpolates before selecting services.
- **Root cause:** The compose file uses required variable expressions inside an optional profile; Compose still validates those expressions during config loading.
- **Prevention rule:** For local Redis-only recovery, either provide all compose-required transient env placeholders or start the Redis image directly with the same port/container name; do not edit `.env*` to bypass it.
- **Files affected:** none; local service startup only.

### 2026-05-12 INFRA: Compose Redis startup missed required env interpolation

- **What went wrong:** I ran `docker compose up -d redis` without a transient `POSTGRES_PASSWORD`, and Compose failed while interpolating the Postgres service environment even though only Redis was targeted.
- **Root cause:** Docker Compose validates required variables for the whole compose file before service selection.
- **Prevention rule:** For targeted Compose service starts in this repo, provide non-secret transient defaults for required variables in the shell invocation when no local `.env` is loaded; never edit or print `.env*`.
- **Files affected:** none; local service startup only.

### 2026-05-12 TOOLING: PowerShell wildcard paths passed directly to rg

- **What went wrong:** I passed `docker-compose*` and `compose*` as positional paths to `rg` in PowerShell, which treated them as invalid literal path patterns and exited nonzero even though it still found Redis references.
- **Root cause:** I mixed shell-style glob habits with ripgrep path arguments on Windows.
- **Prevention rule:** In PowerShell, use `rg` from the repository root with `-g` include globs only, or resolve paths with `Get-ChildItem` before passing them as explicit files.
- **Files affected:** none; inspection command only.

### 2026-05-12 TOOLING: Reused browser script binding while saving QA screenshot

- **What went wrong:** I declared `const fs` in the persistent browser automation runtime even though that binding already existed from earlier QA work, so the screenshot-save script failed before writing the file.
- **Root cause:** I forgot that browser automation variables persist across cells and reused a common binding name.
- **Prevention rule:** In persistent browser scripts, use unique binding names or `globalThis` properties for one-off helpers; never redeclare common names like `fs`, `path`, or `screenshot`.
- **Files affected:** none; validation scripting only.

### 2026-05-12 BUG: Smart intake derived fields with setState effects

- **What went wrong:** I derived the company domain and website by calling `setState` synchronously inside effects, and the React hooks lint gate rejected it.
- **Root cause:** I treated derived form defaults as synchronization work instead of handling them directly in the user input handlers.
- **Prevention rule:** For form autofill/defaulting, derive values in the event handler or render path; reserve effects for external synchronization and async subscriptions.
- **Files affected:** `apps/web/src/components/company/SmartCompanyDialog.tsx`.

### 2026-05-12 TOOLING: Skill archive read as text

- **What went wrong:** I read downloaded `.skill` package files directly as text, which produced ZIP binary output instead of the skill instructions.
- **Root cause:** I assumed the `.skill` extension was a plain markdown skill file rather than a packaged archive.
- **Prevention rule:** Inspect package entries first and extract the embedded `SKILL.md` before reading or applying a downloaded skill.
- **Files affected:** none.

### 2026-05-11 UX: Broad stat span selector broke animated metrics

- **What went wrong:** `.account-source-stat span` applied `display: block` to nested spans inside `AnimatedMetric`, causing currency values to stack vertically.
- **Root cause:** The old CSS selector targeted all descendant spans instead of only the direct label span.
- **Prevention rule:** For stat/card typography selectors, prefer direct-child selectors before introducing nested animated/text components.
- **Files affected:** `apps/web/src/index.css`.

### 2026-05-11 UX: Animated currency metric wrapped mid-value

- **What went wrong:** The new animated metric split currency prefix, number, and suffix into separate inline nodes, so a narrow KPI tile could wrap `€6.33M` across multiple lines.
- **Root cause:** I animated the numeric portion without wrapping the assembled metric in a no-wrap container.
- **Prevention rule:** Any animated metric that separates prefix/number/suffix must render inside a single `white-space: nowrap` wrapper.
- **Files affected:** `apps/web/src/components/motion/AnimatedMetric.tsx`, `apps/web/src/index.css`.

### 2026-05-11 TOOLING: In-app browser click bridge timed out on dense page

- **What went wrong:** The in-app browser locator found account cockpit links, but the click operation timed out inside the browser automation bridge on the motion-heavy dashboard.
- **Root cause:** I relied on the in-app click path for a dense animated page instead of using direct route navigation once link presence had already been verified.
- **Prevention rule:** For browser QA on dense local pages, verify link presence in the in-app browser, then use direct route navigation or external Playwright for click-through/error collection.
- **Files affected:** none; validation harness only.

### 2026-05-11 TOOLING: Reused persistent browser variable name

- **What went wrong:** I declared `const links` in a Node-backed browser session where that identifier already existed from a prior verification call.
- **Root cause:** I forgot that the browser automation kernel persists top-level bindings across calls.
- **Prevention rule:** In persistent browser sessions, use unique verification variable names or assign to `globalThis` once; avoid redeclaring generic names like `links`.
- **Files affected:** none; validation harness only.

### 2026-05-11 BUG: Motion rail used wrong provider health field

- **What went wrong:** I mapped dashboard provider health with `provider.name`, but the shared API contract exposes the display field as `provider.provider`.
- **Root cause:** I inferred the object shape from nearby UI copy instead of checking the shared schema/typecheck before wiring the rail.
- **Prevention rule:** When consuming dashboard health/provider objects, use the schema field names (`provider`, `status`, `latencyMs`, `lastCheckedAt`, `message`) rather than guessed display names.
- **Files affected:** `apps/web/src/pages/AccountsPage.tsx`.

### 2026-05-11 BUG: Animated metric assumed array index narrowing

- **What went wrong:** `AnimatedMetric` checked that `matches.length === 1` but TypeScript still treated `matches[0]` as possibly undefined.
- **Root cause:** I relied on array length narrowing that TypeScript does not guarantee for indexed reads.
- **Prevention rule:** After collecting regex matches, assign `const match = matches[0]` and guard it explicitly before using capture groups or indexes.
- **Files affected:** `apps/web/src/components/motion/AnimatedMetric.tsx`.

### 2026-05-11 TOOLING: Large patch anchored on mojibake text

- **What went wrong:** I tried to patch `AccountsPage.tsx` with a large context block that included existing mojibake copy, so `apply_patch` could not find the expected lines.
- **Root cause:** I relied on copied terminal output containing replacement characters instead of anchoring on stable ASCII structure.
- **Prevention rule:** For files with known encoding artifacts, patch in small chunks around ASCII-only anchors or replace a clearly bounded function wholesale.
- **Files affected:** none; failed patch only.

### 2026-05-11 TOOLING: In-app browser API called without Playwright namespace

- **What went wrong:** I called `tab.getByRole(...)` while validating the running app, but the in-app browser surface exposes locators through `tab.playwright.getByRole(...)`.
- **Root cause:** I mixed external Playwright page APIs with the Browser plugin's wrapped tab API during a quick smoke check.
- **Prevention rule:** In the in-app browser runtime, all locator/screenshot/load-state calls must go through `tab.playwright.*`; reserve bare `page.*` calls for standalone Playwright scripts only.
- **Files affected:** none; validation harness only.

### 2026-05-11 UX: Tech stack icon CDN returned brand 404s

- **What went wrong:** The cockpit tech-stack pills used Simple Icons slugs that now return 404 for several common enterprise brands, creating browser console errors on account detail pages.
- **Root cause:** I assumed old Simple Icons slugs for Microsoft, AWS, CrowdStrike, and others would remain stable instead of validating the current CDN behavior.
- **Prevention rule:** For decorative tech logos, prefer a resilient domain favicon path with initials fallback, or validate icon CDN slugs in tests before shipping them.
- **Files affected:** `apps/web/src/components/company/TechLogo.tsx`.

### 2026-05-11 UX: Logo fallback produced browser console noise

- **What went wrong:** Account dashboard QA surfaced direct `/favicon.ico` fallbacks that logged failed resource errors, plus a React warning for the `fetchPriority` image prop in the current React/Vite runtime.
- **Root cause:** The logo component treated direct favicons as a harmless fallback, but failed image fetches still pollute browser diagnostics; React 18 also warns on that camelCase image hint.
- **Prevention rule:** Company logos should prefer stored/provider URLs and a resilient favicon service fallback before any direct favicon URL, and avoid image props that the current React runtime does not recognize.
- **Files affected:** `apps/web/src/components/company/CompanyLogo.tsx`.

### 2026-05-11 BUG: Health score render used mutable cursor

- **What went wrong:** The new health donut built its conic-gradient stops by mutating a local `cursor` during render, and TypeScript also flagged indexed health counts as possibly undefined.
- **Root cause:** I wrote the render calculation imperatively instead of using an immutable accumulator and explicit `?? 0` fallbacks for record access.
- **Prevention rule:** Derived render data in React components should be built with pure `map`/`reduce` objects and guarded record reads, especially when eslint immutability rules are active.
- **Files affected:** `apps/web/src/components/cockpit/HealthScoreCard.tsx`.

### 2026-05-11 BUG: Tooltip index narrowed visually but not for TypeScript

- **What went wrong:** I added a chart tooltip under a `tooltip ? ... : null` branch but continued indexing arrays with `hover`, which TypeScript still treated as `number | null`.
- **Root cause:** I assumed the derived `tooltip` object would narrow the original state variable, but TypeScript does not connect those conditions.
- **Prevention rule:** For nullable UI indexes, create a non-null derived object that carries both the index and the point data, then render from that object instead of reusing the nullable state.
- **Files affected:** `apps/web/src/components/sales/MonthlySalesChart.tsx`.

### 2026-05-11 TOOLING: Playwright package name mismatch

- **What went wrong:** After moving the smoke script into the web workspace, I still imported `playwright` directly even though this package exposes the runtime through `@playwright/test`.
- **Root cause:** I assumed the transitive Playwright package name was directly resolvable from pnpm's isolated workspace layout.
- **Prevention rule:** In this repo, ad hoc browser smoke scripts should import from `@playwright/test` unless `playwright` is explicitly listed as a direct dependency.
- **Files affected:** none; validation tooling only.

### 2026-05-11 TOOLING: Root Playwright require failed

- **What went wrong:** I ran a root-level Node smoke script with `require('playwright')`, but the browser dependency is available through the web workspace tooling, not root module resolution.
- **Root cause:** I switched fallback strategies quickly after in-app screenshot timeouts and did not verify package resolution from the current working directory.
- **Prevention rule:** Browser smoke scripts should run through `pnpm --filter @bidstack/web exec ...` or from `apps/web` so Playwright dependencies resolve predictably.
- **Files affected:** none; validation tooling only.

### 2026-05-11 TOOLING: Browser screenshot path timed out

- **What went wrong:** The Playwright screenshot call timed out during visual QA of the sales dashboard.
- **Root cause:** I used the heavier screenshot path first instead of the in-app browser's visible capture path after a motion-heavy page update.
- **Prevention rule:** For quick visual QA in the Codex in-app browser, try `cua.get_visible_screenshot()` first; fall back to Playwright screenshots only when a full-page capture is necessary.
- **Files affected:** none; validation tooling only.

### 2026-05-11 TOOLING: Browser wait used unsupported `networkidle`

- **What went wrong:** I called the in-app browser wait helper with `networkidle`, and the runtime rejected that state.
- **Root cause:** I trusted the skill API reference over the runtime's narrower implementation.
- **Prevention rule:** For this browser runtime, use `load` or `domcontentloaded` waits unless `networkidle` support has been confirmed in the current session.
- **Files affected:** none; validation sequencing only.

### 2026-05-11 PROCESS: Partial Browser skill read

- **What went wrong:** I read only the first chunk of the Browser skill file even though the skill explicitly requires reading the entire `SKILL.md` before browser work.
- **Root cause:** I used a quick `Select-Object -First` habit for context minimization on a file whose instructions overrode that shortcut.
- **Prevention rule:** When a skill says to read the entire file, use one full-file read before any related tool action, even if the first section appears sufficient.
- **Files affected:** none; process log only.

### 2026-05-11 BUG: Mantu official favicon attributed as generic favicon

- **What went wrong:** The enrichment helper picked the favicon fallback source before the Mantu official-website override, so Mantu's official favicon was serialized as `favicon` instead of `official_website`.
- **Root cause:** I changed logo source precedence while extracting a shared enrichment helper and did not preserve the Mantu-specific attribution rule.
- **Prevention rule:** For canonical seed accounts with locked attribution, assert both logo URL and logo source after any enrichment refactor.
- **Files affected:** `apps/api/src/routes/crm.ts`.

### 2026-05-11 PROCESS: Repeated stale shared dist validation sequence

- **What went wrong:** I ran API/web typechecks in parallel with `@bidstack/shared` build after adding a shared CRM contract, so consumers saw stale dist output and failed to import `CompanyAutopopulateResponse`.
- **Root cause:** I treated "shared build is included in the same parallel batch" as equivalent to "shared build completed before consumers start", which repeated an existing stale-dist failure mode.
- **Prevention rule:** Shared contract edits require a completed serial `pnpm --filter @bidstack/shared build` before any consumer package validation starts. Do not parallelize that first build.
- **Files affected:** none; validation sequencing only.

### 2026-05-11 BUG: New shared schema consumed before dist build completed

- **What went wrong:** API route registration and consumer typechecks saw an undefined/missing `CompanyAutopopulateResponse` because consumer checks started before the rebuilt shared dist was available.
- **Root cause:** I diagnosed it as a missing export before confirming the source barrel and dist output; the true issue was validation order.
- **Prevention rule:** For shared contract edits, verify source export and completed dist output before starting API/web route tests.
- **Files affected:** `packages/shared/src/schemas/crm.ts`, `packages/shared/src/index.ts`, `apps/api/src/routes/crm.ts`, `apps/web/src/hooks/useAutopopulateSalesCompanies.ts`.

### 2026-05-11 TOOLING: Browser smoke used unsupported networkidle state

- **What went wrong:** The in-app browser runtime rejected `waitForLoadState({ state: "networkidle" })` during the sales page smoke.
- **Root cause:** I followed generic Playwright habit instead of verifying the local browser runtime's supported load-state behavior.
- **Prevention rule:** For this browser plugin, prefer `domcontentloaded` or a concrete DOM/screenshot check after reload unless `networkidle` has already been proven supported in the current runtime.
- **Files affected:** none; browser smoke only.

### 2026-05-11 BUG: Open enrichment metadata was too wide for Prisma JSON

- **What went wrong:** The API route stored open-provider metadata typed as `Record<string, unknown>`, which TypeScript correctly rejected as wider than Prisma's JSON input contract.
- **Root cause:** I used Zod/shared metadata types directly at the Prisma write boundary instead of narrowing them to `Prisma.InputJsonValue`.
- **Prevention rule:** Before assigning provider metadata to Prisma JSON fields, cast only at the final write boundary or build the object as a `Prisma.InputJsonObject` with JSON-compatible values.
- **Files affected:** `apps/api/src/routes/crm.ts`.

### 2026-05-11 TOOLING: Prettier was not run before checking formatting

- **What went wrong:** `pnpm format:check` failed on the new open enrichment provider and CRM route.
- **Root cause:** I added multi-line TypeScript objects and ran the check before formatting the touched files.
- **Prevention rule:** After adding a new TypeScript file or large object literal, run `pnpm format -- <files>` or Prettier on the touched files before `format:check`.
- **Files affected:** `apps/api/src/providers/company-open-enrichment.ts`, `apps/api/src/routes/crm.ts`.

### 2026-05-11 TOOLING: Patch context copied mojibake instead of source text

- **What went wrong:** My first `CompanyLogo` patch failed because I copied the terminal-rendered mojibake form of an em dash instead of the actual source line.
- **Root cause:** I trusted `Get-Content` rendering for a line containing non-ASCII punctuation.
- **Prevention rule:** When a patch misses on a displayed non-ASCII line, re-read the exact line with `Select-String` or patch around ASCII-only anchors.
- **Files affected:** none; the failed patch did not mutate files.

### 2026-05-11 TOOLING: Browser smoke reused a persistent const name

- **What went wrong:** My first in-app browser smoke cell redeclared `snapshot`, which already existed in the persistent browser session, so the check failed before running.
- **Root cause:** I forgot the browser execution context keeps top-level bindings between calls.
- **Prevention rule:** Use unique names for browser smoke variables or a short scratch block when values do not need to persist.
- **Files affected:** none.

### 2026-05-11 TOOLING: Inline TSX probe used wrong package context

- **What went wrong:** I tried to run an inline `tsx` probe from the repo root and then through a filtered package command, which first failed to resolve `tsx` and then imported the API server from the wrong working directory.
- **Root cause:** I mixed root-relative imports with pnpm's package-scoped execution context instead of using the existing Vitest/route tests as the debugging surface.
- **Prevention rule:** For BIDCRM route debugging, prefer focused Vitest tests or `server.inject` inside an existing test file. If an inline probe is unavoidable, run it from the target package directory with package-relative imports and a short timeout.
- **Files affected:** none.

### 2026-05-11 BUG: Malformed Apollo queue patch left duplicate code

- **What went wrong:** My first Apollo job-signing patch left a duplicate tail block in `apps/api/src/queues/company-enrich-apollo.ts` and enqueued the unsigned job instead of the signed payload.
- **Root cause:** I edited the enqueue block too broadly and did not immediately re-read the changed file before continuing.
- **Prevention rule:** After any security-boundary patch that changes control flow, re-open the exact edited file before moving on and verify the payload variable is the value actually passed across the boundary.
- **Files affected:** `apps/api/src/queues/company-enrich-apollo.ts`.

### 2026-05-11 TOOLING: Repeated Prisma generate while API server locked Windows DLL

- **What went wrong:** I reran the root `pnpm typecheck` while the local API dev server was live, so `prisma generate` again failed to rename `query_engine-windows.dll.node`.
- **Root cause:** I parallelized validation after restarting the API for browser QA and did not re-check for DB-client-owning Node processes before the root gate.
- **Prevention rule:** Any root gate containing `pnpm db:generate` must be preceded by a BIDCRM API/worker process check and stop step, even if the API was started only minutes earlier for QA.
- **Files affected:** none; validation sequencing only.

### 2026-05-11 TESTING: Odoo autocomplete response source widened to string

- **What went wrong:** I returned an Odoo autocomplete `source` through a nested ternary without annotating it, so TypeScript widened the literal union to `string` and the Fastify Zod response type rejected the route handler.
- **Root cause:** I trusted value inference inside a returned object instead of typing the public response discriminator.
- **Prevention rule:** For route response discriminators, assign the value to a `z.infer<typeof ResponseSchema>['field']` variable before returning it.
- **Files affected:** `apps/api/src/routes/odoo-integration.ts`.

### 2026-05-11 TOOLING: Prisma generate while API server locked Windows DLL

- **What went wrong:** I ran the root `pnpm typecheck` while the local API dev server was still running, so `prisma generate` failed to rename `query_engine-windows.dll.node`.
- **Root cause:** I forgot the Windows-specific Prisma client file lock before invoking a gate that runs `db:generate`.
- **Prevention rule:** Before any root gate that calls `pnpm db:generate`, stop BIDCRM API/worker Node processes that may have loaded `@bidstack/db`.
- **Files affected:** none; validation order only.

### 2026-05-11 TOOLING: Repeated web typecheck against stale shared dist

- **What went wrong:** I ran `pnpm --filter @bidstack/web typecheck` immediately after adding shared CRM exports, so the web package resolved stale `@bidstack/shared` dist output and reported missing `CrmConnector`/`OpenDataSignal` exports.
- **Root cause:** I remembered the stale-dist issue for full gates but still ran a targeted sibling typecheck before rebuilding shared.
- **Prevention rule:** After any `packages/shared/src/**` contract edit, the very next validation command must be `pnpm --filter @bidstack/shared build` or a root script that performs that build first.
- **Files affected:** none; validation order only.

### 2026-05-11 SHELL: Repeated Bash separator in PowerShell

- **What went wrong:** I ran a PowerShell command containing `&&`, which this shell mode rejects.
- **Root cause:** I bundled a format command and lint command out of habit instead of keeping PowerShell tool calls single-purpose.
- **Prevention rule:** In this workspace, run sequential commands as separate shell tool calls unless using explicit PowerShell control flow.
- **Files affected:** none.

### 2026-05-11 TOOLING: Repeated targeted Prettier unsupported-file mistake

- **What went wrong:** I included `.prettierignore` in another targeted `prettier --write` command, so Prettier formatted the source files but exited nonzero because no parser applies to the ignore file.
- **Root cause:** I used a manual file list after patching the ignore file instead of trusting `pnpm format:check` to validate it.
- **Prevention rule:** Never pass `.prettierignore`, `.gitignore`, Prisma schema, or other tool metadata to targeted Prettier commands unless `--ignore-unknown` is included. Use `pnpm format:check` as the gate for ignore-file changes.
- **Files affected:** none beyond successfully formatted source files.

### 2026-05-11 TOOLING: API tests consumed stale shared dist contracts

- **What went wrong:** The API route schema imported new shared Zod contracts, but `@bidstack/shared` resolves from `dist`, so `pnpm --filter @bidstack/api test` saw stale exports until the shared package was rebuilt.
- **Root cause:** The root `test` script ran workspace tests without first building shared package artifacts consumed by sibling packages.
- **Prevention rule:** Build `@bidstack/shared` before recursive test runs whenever API/MCP/frontend packages import shared contracts from package exports.
- **Files affected:** `package.json`.

### 2026-05-10 BUG: Audit-injected auth abstraction violated Rules of Hooks

- **What went wrong:** `apps/web/src/lib/auth.tsx` from the audit pipeline shipped three `useAuth/useUser/useSignOut` hooks that called Clerk's hooks **after** an early return for stub mode (`if (stub.user?.id === 'stub-user-1') return …; const clerk = useClerkAuth();`). React's hook order is per-component-instance, not per-app — so any component using these hooks could trigger "Rendered fewer hooks than expected" if it ever switched providers, and Clerk's hooks throw at runtime when there's no `<ClerkProvider>` ancestor (stub mode). ESLint's `react-hooks/rules-of-hooks` flagged it correctly.
- **Root cause:** The author assumed the app would only ever be in one mode per session, then used a runtime conditional to skip Clerk's hooks in stub mode. Both assumptions are right _operationally_ but wrong _for React_. Hooks are unconditional contracts.
- **Prevention rule:** When integrating an SDK whose hooks throw without their provider, never call those hooks conditionally. Instead: gate the _provider tree_ (mount one of two non-overlapping subtrees in `AuthProvider`) and have each subtree expose the same shared `Context`. Consumers always read the shared context — same hooks, same order, every render. The `ClerkAuthBridge` pattern.
- **Files affected:** `apps/web/src/lib/auth.tsx` (refactored).

### 2026-05-10 BUG: Audit used `require()` in a Vite ESM module

- **What went wrong:** `apps/web/src/App.tsx` had `const { SignIn } = require('@clerk/clerk-react')` to "lazy-load" Clerk's SignIn component. Vite's ESM build doesn't have CommonJS `require` at runtime; it would have failed in the browser. ESLint's `@typescript-eslint/no-require-imports` caught it.
- **Root cause:** Pattern carried over from a Node CJS context. In a Vite project, the lazy-load idiom is `React.lazy(() => import(...))`.
- **Prevention rule:** In Vite/ESM apps, `require()` is always wrong. The lint rule already enforces this — keep `@typescript-eslint/no-require-imports: error` on. For genuine lazy loading of named exports use `lazy(() => import(pkg).then(m => ({ default: m.Named })))`.
- **Files affected:** `apps/web/src/App.tsx`.

### 2026-05-10 PROCESS: Audit ran in parallel without a contract for which workspace owns lint

- **What went wrong:** A separate audit pipeline modified ~13 files between my commits, partially applying a 10-phase remediation. Some changes left the workspace in a half-broken state (typecheck fails, tests fail) and contradicted earlier work (Industry enum widening invalidated my fixture-guard test for industry; CI workflow rewritten without the bundle-size guard or 3-job split).
- **Root cause:** No coordination protocol between the audit pipeline and the active session — both wrote to the same tree without locking or branching.
- **Prevention rule:** When two automation pipelines could run in parallel, they MUST work on separate branches (or worktrees) and converge via PR. Never let a long-running audit write directly into the same branch a session is editing. If it happens anyway: pause, run `pnpm -r typecheck && pnpm -r lint && pnpm -r test`, and adopt-or-revert per file before continuing.
- **Files affected:** ~13 audit-modified files across `apps/`, `packages/`, `handoff/`.

### 2026-05-10 TESTING: Industry Zod enum was narrower than seed data

- **What went wrong:** Integration test `POST /opportunities` returned 500 because the `Industry` Zod enum was missing `insurance` (MAPFRE seed) and `transportation` (Logistec seed). The seed wrote those rows directly via Prisma, but the API rejected anything containing the same values on read serialization.
- **Root cause:** I built the Zod schema and the SQL seed in separate sittings and never reconciled them. Closed enums lie in two places and drift if the source of truth isn't enforced.
- **Prevention rule:** When extending a closed enum that constrains an external boundary (HTTP/GraphQL/MCP input), grep every fixture, seed, and migration for literal values of that enum and add a parse-the-fixtures unit test so the build fails on drift. Treat the enum and the seed as one change.
- **Files affected:** `packages/shared/src/schemas/opportunity.ts`, `packages/db/src/seed.ts`, `apps/api/src/routes/opportunities.integration.test.ts`.

### 2026-05-10 PROCESS: Master prompt assumed React 19 + Twenty fork as base

- **What went wrong:** Initial framing assumed Twenty CRM uses React 19 and has a stable `ApplicationRegistration` marketplace contract; both turned out to be wrong (React 18.2.39, marketplace WIP, registry path 404).
- **Root cause:** Trusted prose specs without verifying against upstream code.
- **Prevention rule:** Before committing to a fork/extension architecture, spawn an Explore agent to verify the actual upstream tech stack and extension-point contracts. Treat any prose claim about an upstream's internals as a hypothesis until grepped.
- **Files affected:** SPEC.md (architecture decision documented as standalone-first, Twenty overlay preserved for future).

### 2026-05-18 TOOLING: Forked agent spawn included explicit roles

- **What went wrong:** I attempted to spawn three forked agents with explicit `agent_type` values. The tool rejected the calls because full-history forked agents inherit the parent agent type, model, and reasoning effort.
- **Root cause:** I mixed the full-history fork option with role override parameters without checking this session's spawn constraint.
- **Prevention rule:** When using `fork_context: true`, omit `agent_type`, `model`, and `reasoning_effort`; only set explicit roles when spawning without full-history fork context.
- **Files affected:** none.

### 2026-05-18 TOOLING: Browser skill was read partially first

- **What went wrong:** I opened the Browser skill with `-TotalCount 160` even though its instructions require reading the full `SKILL.md` in one read before browser work.
- **Root cause:** I used my normal quick-inspection habit for a skill file that explicitly disallows partial reads before use.
- **Prevention rule:** For skills, always read the full `SKILL.md` first unless the skill instructions themselves permit partial loading.
- **Files affected:** none.

### 2026-05-18 TOOLING: Patched shell-rendered mojibake instead of exact file text

- **What went wrong:** I tried to patch sidebar copy using the mojibake shown by one shell read (`Â·`, `â€¦`), but the actual file text was valid Unicode and the patch failed.
- **Root cause:** I trusted one console rendering of UTF-8 text instead of confirming with a targeted match before editing.
- **Prevention rule:** When text appears corrupted in terminal output, confirm the exact source line with a targeted read before patching; do not patch rendered mojibake.
- **Files affected:** none.

### 2026-05-18 SHELL: Repeated quote-heavy Select-String failed

- **What went wrong:** I ran another `Select-String` pattern containing embedded quotes and alternation, and PowerShell split it into a bad positional argument.
- **Root cause:** I tried to combine several checks into one quoted pattern instead of using simple single-purpose searches.
- **Prevention rule:** For PowerShell `Select-String`, avoid combined quote-heavy patterns; run separate simple searches or single-quote the full literal pattern.
- **Files affected:** none.

### 2026-05-18 TOOLING: In-app browser screenshot capture timed out

- **What went wrong:** After successful DOM/console route smoke, `Page.captureScreenshot` timed out for the in-app browser tab.
- **Root cause:** The screenshot command can be slower or blocked on complex animated pages; I attempted it after validation instead of treating it as optional evidence.
- **Prevention rule:** For route smoke, collect DOM and console assertions first. Use screenshots as supplementary evidence only, and if capture times out, report that directly instead of retrying in a loop.
- **Files affected:** none.

### 2026-05-18 SHELL: Combined rg pattern treated Windows path escapes as regex

- **What went wrong:** I combined multiple Lead checks into one `rg` command, and the Windows path/backslashes became part of the regex parse failure.
- **Root cause:** I packed verification and target path into a quote-sensitive regex instead of using fixed-string checks.
- **Prevention rule:** Use `rg -F` with one literal pattern per command for Windows path verification, especially when patterns contain quotes or backslashes.
- **Files affected:** none.

### 2026-05-18 TESTING: Targeted Playwright command used wrong binary path and flag

- **What went wrong:** I ran `pnpm --filter @bidstack/web exec playwright ... --screenshot=off`, which failed before executing tests because the recursive exec path did not expose `playwright` and this Playwright version rejected `--screenshot=off`.
- **Root cause:** I copied the intended E2E shape without checking the package's script entry point and supported Playwright CLI flags.
- **Prevention rule:** Prefer the package script (`pnpm --filter @bidstack/web e2e -- ...`) for web E2E, and only pass flags confirmed by the installed Playwright version.
- **Files affected:** none.

### 2026-05-18 TESTING: Playwright package script failed before collecting tests

- **What went wrong:** The corrected web E2E package script failed with `@playwright/test does not provide an export named 'test'` and then reported no tests found.
- **Root cause:** The local Playwright runtime/module resolution is not in a working state for the package-script path, independent of the UI changes under test.
- **Prevention rule:** Treat package-level E2E infrastructure failures separately from browser smoke. Inspect package resolution before claiming E2E coverage, and report route smoke as manual/browser validation when Playwright collection is broken.
- **Files affected:** none.

### 2026-05-18 SHELL: Repeated combined rg pattern failed while checking dashboard animation

- **What went wrong:** I used one combined `rg` pattern with quotes and alternation while searching for dashboard glow classes, and the regex parser rejected it.
- **Root cause:** I repeated a known bad pattern instead of using the documented fixed-string approach from the earlier mistake entry.
- **Prevention rule:** For class/name searches in this repo, default to `rg -F` with one pattern per command. Do not combine alternation and escaped quotes in PowerShell.
- **Files affected:** none.

### 2026-05-20 SHELL: Used reserved `$PID` as a loop variable

- **What went wrong:** I used `$pid` as a PowerShell loop variable while trying to restart the local preview server. PowerShell treats `$PID` as a read-only automatic variable, so the cleanup command errored before it could stop the process.
- **Root cause:** I wrote a quick process loop without checking automatic variable names.
- **Prevention rule:** In PowerShell process loops, use names like `$ownerPid` or `$processIdValue`, never `$pid`/`$PID`.
- **Files affected:** none.

### 2026-05-20 TESTING: Playwright link selector matched multiple account nav items

- **What went wrong:** The mobile account E2E clicked `getByRole('link', { name: 'Accounts' })`, which also matched `Key Accounts` and `Top Accounts` in strict mode.
- **Root cause:** I used a substring role-name selector in a navigation menu with related labels.
- **Prevention rule:** For navigation labels that are substrings of other labels, use exact role matching: `{ name: 'Accounts', exact: true }`.
- **Files affected:** `apps/web/e2e/account-detail.spec.ts`.

### 2026-05-20 LINT: OCR wrapper dropped caught error context

- **What went wrong:** The first OCR helper lint run failed because a thrown extraction error did not preserve the original caught error as `cause`.
- **Root cause:** I optimized the user-facing error message before checking the repo's `preserve-caught-error` lint rule.
- **Prevention rule:** When translating parser/OCR failures into domain errors, always attach the caught error via `{ cause: err }`.
- **Files affected:** `apps/api/src/lib/extract-text.ts`.

### 2026-05-20 TESTING: Intake E2E matched extraction text too broadly

- **What went wrong:** The first focused intake E2E rerun still matched multiple elements because the next-step control's accessible name included the substring `Extract`, and the preview initially served an old bundle.
- **Root cause:** I relied on a visible-label substring in a screen with related extraction copy, then reran before rebuilding the preview bundle.
- **Prevention rule:** Give step-navigation controls precise accessible names and rebuild the Vite preview bundle before rerunning focused Playwright checks.
- **Files affected:** `apps/web/src/pages/IntakePage.tsx`.

### 2026-05-20 BUILD: Cross-package typecheck ran before rebuilding shared exports

- **What went wrong:** API and web typecheck initially reported missing shared exports for the new RFP agent schemas because the consumers resolve `@bidstack/shared` through built output.
- **Root cause:** I added shared source exports and immediately typechecked downstream packages before running the shared package build.
- **Prevention rule:** After adding new exports to `packages/shared`, run `pnpm --filter @bidstack/shared build` before downstream package typechecks.
- **Files affected:** `packages/shared/src/schemas/rfp-agent.ts`, `packages/shared/src/schemas/index.ts`.

### 2026-05-20 TESTING: Opportunities page test leaked DOM between cases

- **What went wrong:** The focused Opportunities page test found two matching `Opportunities` headings because prior renders were still mounted.
- **Root cause:** The test file did not call Testing Library `cleanup()` after each case.
- **Prevention rule:** Component tests without a global cleanup setup must call `cleanup()` in `afterEach`, especially when multiple cases render the same page shell.
- **Files affected:** `apps/web/src/pages/OpportunitiesPage.test.tsx`.

### 2026-05-20 SECURITY: Inspected Claude settings before secret scanning

- **What went wrong:** I read `.claude/settings.json` directly and surfaced a hardcoded API-key-looking value in tool output before replacing it with an environment-variable placeholder.
- **Root cause:** I inspected command configuration before running a targeted secret-safe check.
- **Prevention rule:** Before reading local tool settings, search for key names and redact/patch hardcoded secrets before displaying config contents.
- **Files affected:** `.claude/settings.json`.

### 2026-05-20 SHELL: Recursive Claude directory listing timed out

- **What went wrong:** I recursively listed `.claude`, which traversed large worktrees and `node_modules` until the command timed out.
- **Root cause:** I used broad recursion instead of limiting inspection to the top-level command/config folders.
- **Prevention rule:** For `.claude` and `.codex`, inspect only known shallow paths first: settings, commands, agents, hooks, and rules. Exclude `worktrees`.
- **Files affected:** none.

### 2026-05-25 TESTING: Async webhook fan-out still ran inside query guard context

- **What went wrong:** Route tests failed after successful mutations because fire-and-forget webhook fan-out executed unbounded `findMany` calls inside the same guarded async context.
- **Root cause:** I focused on the foreground mutation path first and missed background work launched by the route.
- **Prevention rule:** Any database query reachable from a request, including queued or fire-and-forget fan-out, must use explicit pagination or bounded `take` values before running integration tests.
- **Files affected:** `apps/api/src/queues/webhook-delivery.ts`.

### 2026-05-25 BUILD: Shared schema changes require built dist refresh

- **What went wrong:** The API kept using stale shared package output until the shared package was rebuilt.
- **Root cause:** Consumer packages resolve `@bidstack/shared` through `dist`, not directly from source.
- **Prevention rule:** After changing shared schemas or exports, run `pnpm --filter @bidstack/shared build` before downstream typecheck/test gates.
- **Files affected:** `packages/shared/src/schemas/opportunity.ts`, `packages/shared/dist/*`.

### 2026-05-25 AUDIT: Transitive mobile advisories blocked root high audit

- **What went wrong:** High-severity advisories from transitive Expo mobile dependencies kept `pnpm audit --audit-level high` failing even though the CRM app code did not import those packages directly.
- **Root cause:** I treated the audit as an app-only gate at first instead of the root workspace dependency graph.
- **Prevention rule:** For root audit failures in transitive packages, prefer targeted `pnpm.overrides` plus a lockfile refresh, then rerun the root audit gate.
- **Files affected:** `package.json`, `pnpm-lock.yaml`.

### 2026-06-06 TESTING: Root tests used stale DB dist

- **What went wrong:** API tests still failed with compound Prisma selector errors after the source middleware fix because `@bidstack/db` resolves through `packages/db/dist`, and the root test script did not rebuild the DB package.
- **Root cause:** I patched DB source and immediately ran consumer tests without refreshing the exported workspace package output.
- **Prevention rule:** When changing any package consumed through `dist`, rebuild that package before downstream tests. The root `pnpm test` gate now builds `@bidstack/db` before running worker/API/MCP/web tests.
- **Files affected:** `package.json`, `packages/db/src/middleware/soft-delete.ts`.

### 2026-06-06 BACKEND: Soft-delete middleware broke compound unique lookups

- **What went wrong:** The middleware converted `findUnique({ where: { orgId_kind: ... } })` to `findFirst` but kept the compound unique alias, causing Prisma validation errors in dashboard widgets, company enrichment, and meeting-notes import.
- **Root cause:** The action rewrite changed the required Prisma argument shape, but the middleware did not normalize compound unique selectors into field filters.
- **Prevention rule:** Any Prisma middleware that rewrites actions must include argument-shape regression tests for scalar unique and compound unique selectors.
- **Files affected:** `packages/db/src/middleware/soft-delete.ts`, `packages/db/src/middleware/soft-delete.test.ts`.

### 2026-06-06 SHELL: Used `&&` in PowerShell verification

- **What went wrong:** I tried to chain two verification commands with `&&`, which this PowerShell runtime rejected before any tests ran.
- **Root cause:** I assumed a newer shell separator behavior instead of using one PowerShell command per verification.
- **Prevention rule:** Run verification commands separately in PowerShell unless the separator is already known to work in this environment.
- **Files affected:** none.

### 2026-06-06 TESTING: Generic signal row extractor missed article payloads

- **What went wrong:** The first Apollo public-news cross-check test failed because `rowsFromUnknown()` did not recognize `articles` as a collection key, so GDELT article results were ignored.
- **Root cause:** I reused a generic row extractor built around CRM/provider list names without adding the new public-news response shape.
- **Prevention rule:** When adding a provider response source, add a focused mapping test for its exact list key before assuming the shared extractor covers it.
- **Files affected:** `apps/worker/src/queues/company-enrich-apollo.ts`, `apps/worker/src/queues/company-enrich-apollo.test.ts`.

### 2026-06-06 SHELL: Reused reserved `$PID` while restarting local servers

- **What went wrong:** I used `$pid` as a loop variable while stopping the local API/Vite listeners. PowerShell treats `$PID` as a read-only automatic variable, so the cleanup did not stop the old listeners and new starts collided with them.
- **Root cause:** I repeated a known PowerShell variable-name trap.
- **Prevention rule:** Use `$procId`, `$ownerPid`, or `$processIdValue` for process loops. Never use `$pid` or `$PID`.
- **Files affected:** none.

### 2026-06-06 FRONTEND: Pipeline cards regressed to draggable anchors

- **What went wrong:** The pipeline card was rendered as a draggable React Router `Link`, reintroducing a previously documented bug where browser link-drag behavior can override the intended opportunity-id payload and make moves appear successful while the card stays put.
- **Root cause:** The split `PipelineCard` component drifted from `docs/solutions/drag-drop-not-on-anchor.md`, and the existing E2E only checked that drag did not throw instead of verifying board placement plus persisted API state.
- **Prevention rule:** Draggable CRM records must not be anchors. Add stable `data-testid`/stage attributes and reversible E2E that verifies both UI placement and backend persistence after a move.
- **Files affected:** `apps/web/src/pages/pipelineBoard/PipelineCard.tsx`, `StageColumn.tsx`, `apps/web/e2e/flows/pipeline.spec.ts`.

### 2026-06-06 TESTING: Page tests leaked exchange-rate fetches

- **What went wrong:** Web tests passed but printed happy-dom `AbortError` stacks after teardown.
- **Root cause:** Page tests for Territories and Opportunities mocked CRM data hooks but rendered `useFormatMoney`, which starts `fetchRates()` on mount. Because the tests did not stub that exchange-rate fetch, happy-dom aborted pending real fetch tasks during teardown.
- **Prevention rule:** Any test rendering a component that calls `useFormatMoney` or `useDisplayMoney` must either preload cached rates or stub `/api/v1/exchange-rates` with a settled response.
- **Files affected:** `apps/web/src/pages/TerritoriesPage.test.tsx`, `apps/web/src/pages/OpportunitiesPage.test.tsx`.

### 2026-06-06 TYPESCRIPT: Env helper used an overly strict ProcessEnv Pick

- **What went wrong:** The first MCP fail-closed rate-limit patch failed typecheck because the helper accepted `Pick<NodeJS.ProcessEnv, ...>`, which required optional process env keys to be present.
- **Root cause:** I used a narrow mapped type against `ProcessEnv` instead of a purpose-built object shape with optional keys.
- **Prevention rule:** Env helper seams should accept a small explicit interface such as `{ NODE_ENV?: string }`, not `Pick<ProcessEnv, ...>`.
- **Files affected:** `apps/mcp-server/src/plugins/hourly-rate-limit.ts`.

### 2026-06-06 SHELL: Assumed a test helper file existed

- **What went wrong:** I tried to read `apps/api/src/routes/opportunities.test-helpers.ts`, which does not exist.
- **Root cause:** I guessed the helper filename instead of listing matching route test files first.
- **Prevention rule:** When looking for test helpers, run `rg --files` or `Get-ChildItem` for the pattern before reading a specific path.
- **Files affected:** none.

### 2026-06-06 BACKEND: Reused contact filters for notes

- **What went wrong:** The first grounded opportunity-brief route returned 400 because it queried `Note` with `{ customer: ... }`, but notes use legacy `accountId`.
- **Root cause:** I reused an OR filter across models with different account field names, and TypeScript did not catch the loose Prisma filter shape.
- **Prevention rule:** Keep per-model account filters separate (`Contact.customer`, `Note.accountId`, optional shared `companyId`) and add route tests for generated brief endpoints, not just pure builder tests.
- **Files affected:** `apps/api/src/routes/opportunities.transitions.ts`, `apps/api/src/routes/opportunities.integration.test.ts`.

### 2026-06-06 SHELL: Passed ESLint flags through pnpm incorrectly

- **What went wrong:** I ran `pnpm --filter <pkg> lint -- --quiet`, which caused the package script `eslint .` to receive `--` and `--quiet` as file patterns instead of a flag.
- **Root cause:** I treated `pnpm run` argument forwarding like direct `eslint` execution.
- **Prevention rule:** For package lint flags, use `pnpm --filter <pkg> exec eslint . --quiet` or run the package lint script without extra flags.
- **Files affected:** none.

### 2026-06-06 TESTING: Parallel verification raced Prisma engine availability

- **What went wrong:** A worker Vitest run passed all tests but ended with an unhandled Prisma query-engine initialization error after Prisma client regeneration.
- **Root cause:** I ran multiple verification commands in parallel immediately after regenerating the Prisma client on Windows, where the query engine DLL is frequently renamed/recreated by the local workaround.
- **Prevention rule:** After `pnpm db:generate` on Windows, confirm `packages/db/generated/client/query_engine-windows.dll.node` exists and run Prisma-dependent tests serially before parallelizing other gates.
- **Files affected:** none.

### 2026-06-06 TESTING: Root API tests ran against an unmigrated local DB

- **What went wrong:** Root `pnpm test` reached API integration tests but failed with missing-column errors for `crews.standard_key` and `review_issues.proposal_id`.
- **Root cause:** The Prisma schema/client and migration files had the new additive columns, but the local `DATABASE_URL` database was still behind those migrations.
- **Prevention rule:** When a root test failure is a missing DB column/table, check the masked `DATABASE_URL` target, apply non-destructive pending migrations with `pnpm db:migrate:deploy`, then rerun the focused suites before broad gates.
- **Files affected:** local database only.

### 2026-06-06 SHELL: Probed workspace env with the wrong package context

- **What went wrong:** I tried to import `dotenv-flow` from root-level `node`/`pnpm exec node`, but `dotenv-flow` is installed in workspace packages, not at the root.
- **Root cause:** I ignored pnpm's package-scoped dependency boundary for a one-off diagnostic command.
- **Prevention rule:** For package-owned dependencies, run one-off diagnostics through `pnpm --filter <package> exec ...` from that package context.
- **Files affected:** none.

### 2026-06-06 TESTING: Nested worker-thread tests crashed Vitest on Windows

- **What went wrong:** The worker preflight exited with native code `3221225477` after `extract-text-sandbox.test.ts` assertions passed.
- **Root cause:** The sandbox worker's pdf-parse v2 path did not call `PDFParse.destroy()`, and the parent also terminated the worker immediately after a normal message. Even after cleanup, pdf-parse in `worker_threads` remained unstable on Windows; the same parser in a plain child process exited cleanly.
- **Prevention rule:** Run the worker suite through the repo wrapper with `--pool=forks`, call parser cleanup methods in `finally`, reserve `worker.terminate()` for timeout/crash paths, and route PDFs through a process sandbox rather than a thread sandbox.
- **Files affected:** `scripts/run-worker-tests.mjs`, `apps/worker/src/lib/extract-text-process-worker.ts`, `apps/worker/src/lib/extract-text-worker.ts`, `apps/worker/src/lib/extract-text-sandbox.ts`, `docs/solutions/worker-vitest-wrapper-windows.md`.

### 2026-06-07 TESTING: Assumed a shared audit-log schema test existed

- **What went wrong:** I ran `pnpm --filter @bidstack/shared test -- --run src/schemas/audit-log.test.ts`, which failed because no such test file exists.
- **Root cause:** I assumed schema tests existed before checking the package's test files.
- **Prevention rule:** Before focused test commands, verify the test path with `rg --files`; for schema-only export changes, prefer `pnpm --filter @bidstack/shared build` and `typecheck` unless a real test file exists.
- **Files affected:** none.

### 2026-06-07 SHELL: Parsed API-owned XLSX from the wrong package context

- **What went wrong:** A live audit XLSX smoke downloaded the file successfully but the parsing command failed because root-level `node` could not resolve `@e965/xlsx`.
- **Root cause:** `@e965/xlsx` is owned by the API package, not the root workspace context.
- **Prevention rule:** One-off diagnostics that import package-owned dependencies must run through `pnpm --filter <package> exec ...`.
- **Files affected:** none.

### 2026-06-07 SHELL: Over-escaped a simple rg search in PowerShell

- **What went wrong:** I tried to count `lucide-react` imports with a quote-heavy escaped command and PowerShell rejected it before `rg` ran.
- **Root cause:** I used shell-escaped regex syntax for a simple literal search.
- **Prevention rule:** For simple literal searches in PowerShell, use `rg -n 'literal' path` and avoid quote-heavy regexes unless they are actually needed.
- **Files affected:** none.

### 2026-06-07 BACKEND: Generic mutation audit was too broad at first

- **What went wrong:** The first mutation-audit safety-net version wrote a generic audit row for every authenticated successful mutation, including routes that already create rich domain audit rows.
- **Root cause:** I optimized for "everything is tracked" without first separating unaudited route families from already-audited hot paths.
- **Prevention rule:** Request-level mutation audit must be a safety net for unaudited route families, not a duplicate audit row on rich domain routes. Verify with full API tests, not only focused plugin tests.
- **Files affected:** `apps/api/src/plugins/mutation-audit.ts`, `apps/api/src/plugins/mutation-audit.test.ts`, `docs/solutions/mutation-audit-safety-net.md`.

### 2026-06-07 SHELL: Fumbled one-off API route inventory commands

- **What went wrong:** The first Fastify route inventory probes failed because I mixed top-level await in `tsx -e`, missed `dotenv-flow` loading, used the wrong import context, and waited on server shutdown handles longer than needed.
- **Root cause:** I treated a package-scoped diagnostic like a generic root shell snippet instead of constructing the command around the API package runtime.
- **Prevention rule:** For API route inventory diagnostics, run through `pnpm --filter @bidstack/api exec tsx`, import `dotenv-flow/config`, use an async IIFE or explicit `process.exit(0)` after printing, and keep the import path rooted to the current command context.
- **Files affected:** none.

### 2026-06-07 TESTING: Let Redis-backed rate limits leak between API test runs

- **What went wrong:** Full API tests started returning 429 for CRM company enrichment routes after repeated runs.
- **Root cause:** The API registered `@fastify/rate-limit` with Redis in `NODE_ENV=test`, so route-specific counters persisted across independent Vitest invocations.
- **Prevention rule:** Test-mode API servers should keep rate-limit counters process-local unless a test explicitly verifies Redis-backed limiting. Production/dev may use Redis; tests need isolation.
- **Files affected:** `apps/api/src/server.ts`.

### 2026-06-07 TESTING: Used random four-digit opportunity codes in persistent DB fixtures

- **What went wrong:** Penetration tests failed on rerun with a unique constraint collision on `(org_id, code)`.
- **Root cause:** The fixture used `OP-1000..9999`, which is not collision-proof when old test rows survive or tests run repeatedly.
- **Prevention rule:** Persistent DB fixtures with unique constraints need UUID-backed values, not small random ranges.
- **Files affected:** `apps/api/src/security/penetration.test-helpers.ts`.

### 2026-06-07 BACKEND: Audit export limit could under-report truncation

- **What went wrong:** XLSX export metadata could say `Truncated by limit: no` when the export hit its row limit inside an already-fetched batch.
- **Root cause:** The truncation check only looked for another database page after the batch cursor and did not remember that unprocessed matching rows could still exist later in the current batch.
- **Prevention rule:** Export collectors must set truncation as soon as the limit is reached before the fetched batch is fully inspected, then preserve that flag through later checks.
- **Files affected:** `apps/api/src/routes/audit-logs.ts`, `apps/api/src/routes/audit-logs.test.ts`, `docs/solutions/audit-log-server-side-xlsx-export.md`.

### 2026-06-07 SHELL: Used a malformed regex while checking the Prisma schema

- **What went wrong:** A schema search command failed with an unopened-regex-group error.
- **Root cause:** I tried to combine two patterns and a path in one `rg` expression instead of using a simple literal search or separate `rg` calls.
- **Prevention rule:** For schema location checks, prefer `rg -n 'model Name' path` and then read nearby lines; avoid compound regexes unless they are tested.
- **Files affected:** none.

### 2026-06-07 TESTING: Sent nullable parentId to a non-nullable create contract

- **What went wrong:** The new company CRUD audit integration test failed with `400` on create because the payload sent `parentId: null`.
- **Root cause:** `CompanyCreate` makes `parentId` optional, not nullable, while `CompanyPatch` allows nullable parent clearing.
- **Prevention rule:** Before writing route tests, inspect the exact shared create/patch schemas and match their optional-vs-nullable contract.
- **Files affected:** `apps/api/src/routes/companies.test.ts`.

### 2026-06-07 BROWSER: Used DOM constructors in the in-app browser read-only scope

- **What went wrong:** A browser inspection script used `instanceof HTMLAnchorElement` and failed because the in-app browser's restricted evaluate scope did not expose that constructor.
- **Root cause:** I assumed normal browser globals were available inside the Codex browser runtime's read-only evaluation wrapper.
- **Prevention rule:** In in-app browser `evaluate` checks, prefer plain `tagName` and attribute reads instead of `instanceof` or constructor-based DOM checks.
- **Files affected:** none.
