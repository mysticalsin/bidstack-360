# Issue Register

## AGENT-STUDIO-002: Crew Runs Were Pasted-Text Only Despite Existing RFP Evidence

State: resolved - Owner: Codex - Source: Follow-up from Agent Studio RFP workflow hardening.

Problem: Agent Studio could run an RFP crew, and the CRM already had bid-workspace documents/requirements from OCR/extraction, but the crew runner still required pasted text. That made the RFP answer process feel disconnected and risked agents working without source IDs or citations.

Fix: Added an Agent Studio evidence handoff panel that searches opportunities, loads `GET /api/v1/bid-workspaces/:opportunityId`, shows document/requirement counts, links back to the RFP pipeline, and loads a bounded cited evidence bundle into the crew input. Crew run inputs now include `opportunityId`, `documentIds`, `requirementIds`, and `evidenceSource=bid_workspace`.

Verification: Focused evidence tests passed 2/2; focused Agent Studio lint passed; web typecheck passed; web build passed; in-app browser smoke confirmed live opportunity search, workspace evidence loading, preserved line breaks, enabled `Run crew`, and no app console errors.

Remaining: Full upload/import -> OCR/Omniparse -> source chunks/requirements -> crew run -> cited draft -> approval gates still needs an end-to-end E2E and persistence hardening slice.

---

## TWENTY-PARITY-001: Twenty Feature Parity Needs A Verified Module Matrix

State: open - Owner: Unassigned - Source: Tony requested full Twenty feature parity.

Problem: Twenty's current public materials describe an open-source CRM designed for AI with extensible building blocks such as objects, views, workflows, and agents, plus CRM surfaces for companies, people, opportunities, tasks, notes, dashboards, workflows, command search, and custom app publishing. BidStack has several matching primitives, but there is not yet a verified module-by-module parity matrix proving every Twenty capability is implemented, wired to backend data, tested, and not a skeleton.

Next: Create a parity matrix from primary Twenty sources (`https://github.com/twentyhq/twenty`, `https://twenty.com/`, and Twenty docs), map each feature to BidStack routes/API/models/tests, then close gaps one slice at a time. Do not mark parity complete until each row has browser QA, API coverage, and backend persistence evidence.

Verification: Not fixed in this slice. Agent Studio evidence handoff is complete; full Twenty parity remains open and should be treated as a product roadmap epic, not a single UI polish task.

---

## AGENT-PROVIDER-CREDS-2026-06-07: Direct model keys were platform-only

State: resolved - Owner: Codex - Source: Follow-up from Agent Studio provider-neutral RFP agent work.

Problem: Agent Studio supported provider selection and readiness display, but direct providers were still platform-env only. Admins could not configure org-owned Claude, OpenAI, Kimi, NVIDIA NIM, or Gemma/local credentials from the CRM.

Fix: Added encrypted org-scoped provider credentials, admin-only writes, masked listing, readiness integration, and execution routing that prefers org credentials before platform fallback.

Verification: Focused API tests passed 5/5; focused API/web lint passed; API/web typecheck passed; web build passed; reversible Gemma credential API smoke passed; Settings AI browser smoke passed; `/agent-studio` browser smoke passed.

---

## INTEGRATION-CONFIGS-2026-06-07: Named constraint upsert caused credential 500s

State: resolved_runtime_followup_schema - Owner: Codex - Source: Live API smoke during provider credential work.

Problem: Credential writes used `ON CONFLICT ON CONSTRAINT integration_configs_org_type_name_key`, but the live local DB does not have that named constraint, causing `500` on save.

Fix: Replaced named-constraint upsert with a transaction-scoped advisory lock, update active row by `{ orgId,type,name }`, insert if missing, and write audit evidence in the same transaction. Applied the same pattern to Dust credential writes.

Verification: Reversible provider credential smoke passed after the fix; focused API typecheck, lint, and provider helper tests passed.

Remaining schema follow-up: Add a proper additive migration for a unique active `(org_id,type,name)` invariant and a generic AI provider config type instead of compatibility storage under `type='dust'`.

---

## AGENT-PROVIDER-STATUS-2026-06-07: Provider choices lacked visible readiness and setup contracts

State: resolved - Owner: Codex - Source: Follow-up from Agent Studio provider-neutral RFP agent work.

Problem: Agent Studio let admins select provider/model families, but users had no reliable in-app answer to "which providers are actually configured?" That creates empty-shell UX and risky support behavior, especially when Dust, Claude, OpenAI, Kimi, NVIDIA NIM, and local providers have different server-side env contracts.

Fix: Added a shared provider-readiness schema, `GET /api/v1/agents/provider-status`, a React Query hook, and a reusable readiness card in `/agent-studio` and Settings -> Integrations -> AI & Agents. The response reports provider status, setup source, model, endpoint, missing env keys, and notes without returning secret values.

Verification: Shared build passed; provider helper tests passed 4/4; shared schema tests passed 4/4; focused API/web lint passed; API/web typecheck passed; web build passed; direct local route check passed; in-app browser smoke passed for Agent Studio and Settings AI & Agents.

---

## AGENT-STUDIO-UX-2026-06-07: Agent Studio did not guide the full RFP agent workflow

State: resolved - Owner: Codex - Source: Tony requested Twenty-style AI/workflow review, OCR/RFP agent flow clarity, provider flexibility, and a sticky hamburger/sidebar fix.

Problem: Agent Studio exposed agents and crews but did not make the production path obvious to a user dropping in an RFP. The desktop sidebar also had an inline `position: relative` override that prevented the sticky navigation/collapse control from staying anchored on long pages.

Fix: Added an RFP automation control tower, Intake/OCR/run-panel guidance, operational state cards, provider-neutral agent configuration for Dust, Claude, OpenAI, Kimi, NVIDIA NIM, and Gemma/local OpenAI-compatible endpoints, and removed the sidebar sticky override. Added a targeted Playwright regression for the sticky desktop sidebar.

Verification: Focused web lint/typecheck/build passed; API provider helper tests passed 2/2; shared provider schema tests passed 4/4; in-app browser `/agent-studio` smoke passed; targeted Playwright sticky-sidebar test passed.

---

## AGENT-RUN-001: Duplicate Active Agent Runs Could Race

State: resolved - Owner: Codex - Source: 2026-06-07 Codex Agent Studio hardening.

Problem: Starting an agent run always created a new run. A user could double-click or another client could submit during provider latency, producing competing active runs for the same agent.

Fix: Added transaction-scoped advisory locking per org/agent, active queued/running detection, `409` API conflict handling, and regression coverage.

Verification: `pnpm --filter @bidstack/api exec vitest run src/routes/agents.integration.test.ts --reporter=dot` passes.

---

## AGENT-RUN-002: Agent Runs Had No Operator Recovery Controls

State: resolved - Owner: Codex - Source: 2026-06-07 Codex Agent Studio hardening.

Problem: Failed or stuck agent runs had no backend cancel/retry controls, and cancelled runs could be overwritten by a late provider response.

Fix: Added cancel/retry routes, state validation, audit rows, UI timeline buttons, query invalidation, and status-safe completion/failure updates.

Verification: Focused API integration tests, API/web lint, API/web typecheck, and web build pass.

---

## AGENT-STUDIO-001: Crew Runs Were Not Recoverable From History

State: resolved_expanded - Owner: Codex - Source: 2026-06-07 Codex Agent Studio UX hardening.

Problem: Agent Studio let a user run a crew but did not expose prior run inputs in read routes, so the UI could not reopen or rerun prior RFP work.

Fix: Crew-run read routes now return bounded `inputs`, and Agent Studio shows a Run History panel with View and Run again/Retry actions.

Verification: API/web lint, API/web typecheck, web build, and in-app browser smoke on `/agent-studio` pass.

---

## CREW-RUN-001: Crew Runs Needed Queue-Aware Cancel And Retry Controls

State: resolved - Owner: Codex - Source: 2026-06-07 Codex Agent Studio recovery hardening.

Problem: Crew execution could become stuck or fail without a first-class operator recovery path. The worker could also write late results after a user tried to cancel, which is dangerous for RFP governance because cancelled work should stay terminal.

Fix: Added cancel/retry routes with owner-or-admin scoping, queued-job removal, retry from stored bounded inputs, audit rows, mutation-audit safety-net coverage, worker claim guards, and completion/failure guards that prevent cancelled runs from being overwritten.

Verification: `pnpm --filter @bidstack/api exec vitest run src/routes/crews.integration.test.ts src/routes/agents.integration.test.ts --reporter=dot` passed 8/8; focused API/worker/web lint passed; API/worker/web typechecks passed; web build passed; `/agent-studio` browser smoke passed.

Remaining: Superseded by `CREW-RUN-002`; provider calls now receive cooperative
`AbortSignal` cancellation.

---

## CREW-RUN-002: Running Crew Cancellation Did Not Reach Provider Calls

State: resolved - Owner: Codex - Source: 2026-06-07 Codex Agent Studio provider-cancellation hardening.

Problem: Crew cancellation protected database state, but a provider call already in flight could keep running until timeout or completion. That wastes provider spend and can make operators believe a cancelled RFP crew has fully stopped when only persistence was protected.

Fix: Passed `AbortSignal` through the crew engine, crew executor interface, provider-backed executor, shared RFP LLM wrapper, direct model provider client, and Dust client. Added a worker cancellation watcher that aborts active provider calls when the run row leaves `running`. Prevented user cancellations from being logged as fake provider failure telemetry.

Verification: Worker focused tests passed 49/49; Dust client tests passed 3/3; focused worker/Dust eslint passed; Dust client build/typecheck passed; worker typecheck passed; web build passed; `/agent-studio` browser smoke passed with provider readiness visible and sticky shell behavior preserved.

Remaining: Cancellation is cooperative. Provider infrastructure may still finish server-side work after the HTTP request aborts, depending on the provider; CRM state and local worker resources are protected.

---

## SHELL-STICKY-001: Sidebar Footer Disappeared On Long Pages

State: resolved - Owner: Codex - Source: 2026-06-07 Codex navigation UX check.

Problem: On long CRM pages, the sidebar identity/status footer could sit below the viewport, making the navigation feel broken even though the topbar and toggle were sticky.

Fix: Made `.sb-foot` sticky at the viewport bottom with a surface fade so the footer/status area stays available while the sidebar remains scrollable.

Verification: Browser geometry check on `/agent-studio` confirmed the footer is visible at the viewport bottom and no visible page error is present.

---

## DASHBOARD-WIDGET-SLOW-QUERY-2026-06-07: Dashboard widget mutation logged slow DB queries

State: open - Owner: Unassigned - Source: Full API test verification during RBAC audit-log hardening.

Problem: The full API suite passed, but the logs reported slow `DashboardWidget.upsert` queries during `/api/v1/crm/widgets` PATCH tests, including a run above one second. At 50k+ CRM users this can become a dashboard customization bottleneck or an alert-noise source.

Next: Profile the widget upsert route and backing indexes, confirm whether the slowness is test-environment lock contention or real query shape, then add a targeted performance/contract test before changing the route.

Verification: Not fixed in this slice. Current audit-log/RBAC gates are green; this is a separate performance hardening item.

---

## DEPENDENCY-AUDIT-MODERATES-2026-06-07: Moderate dependency advisories remained after high audit gate

State: resolved - Owner: Codex - Source: Full dependency audit during continued CRM stabilization.

Problem: `pnpm audit --audit-level high` passed while full audit still reported moderate advisories in `i18next-http-backend`, `react-router`/`react-router-dom`, and transitive `ws` consumers.

Fix: Upgraded direct web/marketing dependencies to patched versions and added a compatible workspace `ws` override for transitive consumers.

Verification: `pnpm audit` reports no known vulnerabilities; root lint/typecheck/test/build passed; focused web, marketing, and API typechecks passed; focused web and marketing tests passed.

Notes: `pnpm install` ran in an already-dirty workspace, so the lockfile refresh also reflects pre-existing dependency drift. Remaining follow-ups are the ESLint peer warning and the Vite vendor chunk warning.

---

## OPPORTUNITY-LIST-ORDER-2026-06-07: Opportunity list test assumed sorted head was a canonical seed record

State: resolved - Owner: Codex - Source: Root `pnpm test` during continued CRM stabilization.

Problem: `opportunities.integration.test.ts` expected the first `/api/opportunities?limit=20` item to have an `OP-NNNN` code. RFP approval tests can create valid `RFP-*` opportunities in the same seed org while API files run in parallel, so the list head can be a real RFP-derived record.

Fix: The test now validates the page head with the tolerant persisted-read contract, then finds a canonical seed opportunity by stable DB identity and verifies it through a scoped API search.

Verification: Focused opportunity integration test passed 12/12; API lint/typecheck passed; root `pnpm test` passed; root `pnpm build` passed.

---

## E2E-MEETING-IMPORT-POLLUTION-2026-06-07: Meeting-import tests polluted contact/responsive baselines

State: resolved - Owner: Codex - Source: Full web E2E validation after the account cockpit idle fallback.

Problem: Contact and responsive screenshot tests could fail because earlier meeting-import flows created test contacts and related artifacts in the shared seed org. Later tests expected curated seed data but saw `E2E Buyer`, `Attendees:`, `Risk:`, and `Meeting Import` records.

Fix: Browser tests now clean explicit meeting-import contact fingerprints before/after relevant flows. The API notes integration test also cleans its matching contacts, notes, risk items, tasks, and enrichment artifacts. Responsive baselines were verified only after ruling out data pollution.

Verification: Full web E2E passed; web lint/typecheck passed; API typecheck passed; notes route tests passed 7/7.

---

## CRM-COCKPIT-TAB-DISCARD-2026-06-07: Account cockpit lost fallback after browser tab discard

State: resolved - Owner: Codex - Source: Tony re-reported idle account cockpit `Request failed (500)` after leaving the page open too long.

Problem: The previous cockpit resilience patch handled background refresh failures only while React Query still had in-memory `data`. After browser tab discard/reload, that memory can be gone; a transient 5xx then renders the fatal cockpit error again.

Fix: Account pages now keep a schema-validated, tab-scoped `sessionStorage` copy of the last verified dashboard snapshot for that account. The page uses it only for transient 5xx/network errors, never for 4xx/not-found failures, and auth cache cleanup clears these snapshots.

Verification: Focused dashboard/query-cache tests passed 8/8; web typecheck and lint passed; API dashboard route tests passed 5/5; live `/readyz` and affected dashboard endpoint returned 200; in-app browser smoke showed the affected account with no fatal error and no console errors.

---

## OPPORTUNITY-CODE-READ-2026-06-07: Opportunity list reads rejected persisted noncanonical codes

State: resolved - Owner: Codex - Source: Full API gate while validating Tony's idle cockpit crash fix.

Problem: `GET /api/v1/opportunities?limit=20` could serialize a `500` when persisted opportunities had codes outside the strict `OP-NNNN` regex. The read path reused a write-time contract and could crash list views for historical/RFP/test/imported identifiers.

Fix: Split shared opportunity code validation into `OpportunityCode` for bounded persisted reads and `CanonicalOpportunityCode` for write/import-supplied codes. Added tests proving legacy persisted reads succeed while noncanonical supplied write codes still fail.

Verification: Shared build passed; shared tests passed 66/66; opportunities integration tests passed 12/12; full API suite passed 71 files / 495 passed / 2 skipped; live Vite-proxied opportunities list returned 200.

---

## API-REDIS-READINESS-2026-06-07: Redis readiness stayed down after idle/startup blip

State: resolved - Owner: Codex - Source: Tony reported the account cockpit could show `Request failed (500)` after staying on the same page too long.

Problem: The exact dashboard endpoint was healthy, but `/readyz` reported `redis:false` and returned `503` while Redis was reachable. The API Redis client disabled retries/offline queueing to fail fast, but it had no explicit reconnect path from ended/closed states. That could leave long-running local/Azure API processes unhealthy until restart after a transient Redis blip.

Fix: Added `ensureRedisReady()` and `pingRedis()` helpers, routed health and cache calls through them, preserved memory fallback when Redis is still unavailable, and added status-helper tests.

Verification: Redis/health/cache tests passed 11/11; dashboard route tests passed 5/5; dashboard page tests passed 3/3; API lint/typecheck passed; live `/readyz` returned 200 with Redis true; browser smoke on the affected account cockpit had no fatal cockpit error and no console errors.

---

## CRM-COCKPIT-IDLE-500-2026-06-07: Account cockpit replaced stale usable data with a fatal 500 state

State: resolved - Owner: Codex - Source: Tony reported idle account cockpit failure on `GET /api/v1/crm/dashboard?account=20086dc4-4ac4-441b-9c30-b33abdcca98d`.

Problem: When the cockpit query failed during a later/background refresh, the page could render the full fatal "Couldn't load the CRM cockpit" state even if the user already had a valid cockpit snapshot on screen. That made transient API/proxy failures feel like the CRM crashed.

Fix: Dashboard/account cockpit now renders a fatal error only when no snapshot exists. If stale data exists, it stays visible and the page shows an inline live-refresh warning with Retry. The page also queues a bounded Apollo refresh for accounts with missing or stale strategic intel.

Verification: Direct API/proxy request returned 200 for the affected account; browser smoke showed the cockpit with no fatal error or console errors; focused `DashboardPage.test.tsx`, package tests, root lint/typecheck/test/build all passed.

---

## APOLLO-COMPANY-003: Apollo freshness and company cache did not enforce weekly refresh

State: resolved - Owner: Codex - Source: Tony requested Apollo company data cache with automatic weekly updates.

Problem: Stored Apollo strategic-intel metadata could include `freshness: "fresh"` and remain fresh when later parsed, and company enrichment cache rows used a 30-day TTL. That contradicted the weekly freshness requirement.

Fix: Apollo strategic-intel freshness is recomputed from `lastSyncedAt` at serialization time. Local enrichment and Apollo worker cache expiries now use a seven-day TTL. Tests cover stale stored Apollo intel and weekly cache expiry.

Verification: API company service/enrichment tests passed; Apollo worker tests passed; root lint/typecheck/test/build passed.

---

## WEB-I18N-TEST-001: Currency selector test rendered untranslated interpolation placeholders

State: resolved - Owner: Codex - Source: full web test gate during cockpit fix verification.

Problem: `CurrencySelector.test.tsx` rendered the component without the app i18n bootstrap, so assertions saw interpolation placeholders instead of formatted currency/date labels.

Fix: Import `@/i18n` in the test so interpolation behavior matches the app runtime.

Verification: Focused currency selector test and full web test suite passed.

---

## APOLLO-COMPANY-002: Autopopulated companies skipped Apollo verification

State: resolved - Owner: Codex - Source: 2026-06-07 company lifecycle audit after Apollo MCP pass.

Problem: Manual `POST /api/crm/companies/:id/enrich` queued Apollo verification, but `autopopulateCompanies()` only wrote the local verified company cache. Accounts created from sales/opportunity autopopulate could therefore stay at favicon/open-profile data and never receive Apollo company intelligence unless a user manually re-enriched them.

Fix: Call `queueApolloEnrichment()` after each successful autopopulate enrichment write, and keep the fresh-cache path as a no-op to avoid unnecessary Apollo/Redis usage. The direct enrich route now uses the same helper.

Verification: Focused service tests cover queue-on-new-enrichment and no-queue-on-fresh-cache; full API tests, root lint, root typecheck, root test, and root build pass.

---

## ROOT-GATE-DB-DRIFT-2026-06-06: Prisma ledger ahead of physical local DB

State: resolved - Owner: Codex - Source: root `pnpm test` failures on 2026-06-06.

Problem: API integration tests failed with missing-column errors for
`crews.standard_key` and `review_issues.proposal_id`, while
`prisma migrate deploy` reported no pending migrations.

Fix: Verified the masked local DB target, replayed existing idempotent additive
SQL for the affected migrations, and aligned `packages/db/prisma/schema.prisma`
with the existing migration shape.

Verification: Focused API suites passed (`crew-standard`,
`rfp-pipeline.approve`, `bid-workspace`); full `pnpm test`, `pnpm lint`, and
`pnpm typecheck` passed.

---

## WORKER-PDF-SANDBOX-2026-06-06: pdf-parse inside worker_threads crashed Node on Windows

State: resolved - Owner: Codex - Source: root worker preflight native crash
`3221225477`.

Problem: `extract-text-sandbox.test.ts` could pass assertions and then crash the
Vitest worker after a real PDF parse.

Fix: Added `extract-text-process-worker.ts` and routed PDF extraction through a
child-process sandbox with timeout, heap cap, and bounded output. Kept
worker-thread sandbox for non-PDF formats. Worker wrapper now uses Vitest forks.

Verification: Sandbox suite passed 3 consecutive runs; full worker suite passed;
full `pnpm test` passed.

---

## APOLLO-COMPANY-INTEL-2026-06-06: Company-only Apollo enrichment with no emails/phones

State: resolved_for_current_slice - Owner: Codex - Source: Tony request to use
Apollo MCP for company data, tech stack, employees, financials, intent, and news
cross-checking without emails or phone numbers.

Fix: Apollo worker remains MCP company-first with REST org fallback; maps
firmographics, tech, employees, revenue/funding, intent, hiring, news,
investment, and expansion signals; recursively strips contact-channel fields
before persistence; people tools are disabled unless an admin explicitly opts
in.

Verification: `company-enrich-apollo.test.ts` passed 22/22; shared tests passed
65/65; full root gates passed.

---

## CRM-STABILITY-2026-06-06: Runtime/API/MCP gate sweep

State: resolved - Owner: Codex - Source: local full-gate review and browser smoke.

Fixed:
- API wrapper parsed JSON before status/error handling; non-JSON proxy failures produced opaque failures. Now endpoint-scoped errors are content-type aware.
- Dashboard/integrations/pipeline hard-failed entire sections on supporting request failures. Now they render usable fallback UI with inline warnings when possible.
- Pipeline stage moves could visually snap back to stale cached data. Stage mutation now invalidates all relevant opportunity/dashboard/report caches, and visible cards keep their optimistic stage until server data matches.
- MCP opportunity stage enums drifted from canonical pipeline stages. Schemas/tools now use `s1_lead`, `s1_ongoing`, `s2_sent`, `s3_technical_iteration`, `s4_negotiation`, `closed_won`, and `closed_lost`.
- REST API keys with insufficient scope could reach permission gates. API-key users now satisfy `*:write` only with `write` scope and read-like gates only with `read` scope.
- Soft-delete middleware broke Prisma compound unique lookups after rewriting `findUnique` to `findFirst`. Middleware now expands compound unique aliases first.
- Root tests used stale `@bidstack/db` dist. Root `pnpm test` now builds DB before consumer tests.

Verified:
- `pnpm test`, `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm audit --audit-level high`.
- Browser smoke on core CRM routes.
- Reversible pipeline transition via live API.

Residuals:
- Add focused pipeline drag/drop E2E.
- Reduce web happy-dom AbortError teardown noise.
- Continue semantic heading/accessibility polish on page shells.

---

## REVIEW-3 (2026-06-04): deeper 7-subsystem sweep — 21 findings (18 fixed, 3 deferred)

State: mostly resolved — Owner: Claude — Source: `bidcrm-review-round2` workflow (30 agents) over the territory REVIEW-2 only sampled (services/, ~100 unsampled routes, remaining worker queues, unreviewed web pages, mcp-server, performance, resilience).

Blockers fixed (2):
- **signature.service.ts** — internally-signed PDF silently discarded in S3 mode (no-op TODO) while marked SIGNED with a dangling key → implemented driver-agnostic presigned-PUT write + FAIL CLOSED.
- **mcp-server/auth.ts** — MCP auth ignored ApiKey `expiresAt` and `deletedAt` → expired/soft-deleted keys authenticated → added both checks (mirrors REST).

Majors fixed (11):
- predictive-scoring.service.ts — `/100` unit mismatch made the score-drop notification never fire → subtract directly.
- opportunities.export.ts — CSV/formula injection → neutralize leading `= + - @` (mirror invoices.export).
- calendar-sync-google.ts — watch-channel renewal blind-overwrote deltaState, wiping the sync token → spread existing state.
- OpportunitiesPage.tsx — CSV export 400'd for legacy (non-UUID) stage filters → mirror the list query's stage branching.
- Contact.email — N+1 + missing index → `@@index([orgId, email])` + migration `20260604000400_contact_email_index`.
- worker signatures.ts — DocuSign poll fetches had no timeout (sweep stall) → `AbortSignal.timeout`.
- mcp contacts-list/get — returned PII ignoring `aiOptOut` → redact opted-out email/phone.
- mcp tools (15 queries / 12 files) — omitted `deletedAt:null` (soft-deleted leak/resurrect) → added everywhere EXCEPT the 2 code-minters (which must see soft-deleted rows). Done via subagent; typecheck+lint verified.
- workflows.ts PATCH — action edits validated but never persisted (silent data loss) → replace-set actions in a transaction.
- calls.write.routes.ts — IDOR: no org-ownership check on entityId before billable provider calls → `tenantEntityBelongsToOrg` gate (DEAL→opportunity).
- IntakePage IntakeAccountPicker — no loading/error/empty states → added (a failed search no longer masquerades as "no accounts").

DEFERRED (3 majors — confirmed real, well-specified, larger/untestable-here; do as a focused pass):
- **email-sync.pull.ts + microsoft-graph.service.ts** — Graph delta pull never follows `@odata.nextLink`; inboxes >100 msgs (esp. historical seed) stall and re-pull page 1 forever. Fix: loop nextLink until `@odata.deltaLink`, persist only the final cursor.
- **calendar-sync-google.ts + calendar-sync-microsoft.ts** — incremental pulls ignore `nextPageToken`/`@odata.nextLink`; busy calendars stall on page 1. Same loop fix.
- **yjs-compaction.ts** — worker compaction blind-overwrites `ydocBinary` concurrently with the API inline path → lost collaborative edits. Fix: add a version column + compare-and-swap (or a per-ydoc advisory lock). Needs a schema migration.

Minors noted (not fixed): calls.ts CallSession queries by id-only (defense-in-depth; verified not exploitable — all enqueue paths pre-validate orgId); document-extract-db.ts sequential inserts (worker perf smell); signature.service.ts request-path DocuSign fetch timeouts.

Verified: api/worker/web/mcp-server typecheck OK; changed files lint clean; web 248 tests pass; schema valid.

---

## REVIEW-2 (2026-06-04): full-CRM 7-subsystem review — 13 findings, ALL FIXED

State: resolved — Owner: Claude — Source: `bidcrm-full-review` workflow (7 reviewers × adversarial verification, 20 agents). Baseline was healthy (lint clean repo-wide, web 248 + shared tests green, all typecheck OK).

Blockers fixed:
1. `bookings-public.ts` — `config:{auth:'none'}` is an unrecognized flag (hook only honors `public`); public booking funnel 401'd every visitor → `public:true`.
2. `public-sign.ts` — `config:{skipAuth:true}` same bug → external signers 401 → `public:true`.
3. `signatures.ts` — DocuSign webhook missing `public:true` → callbacks 401, signature status never updated → added.
4. `opportunities.helpers.ts` + `opportunities.mutations.ts` — code minter excluded soft-deleted rows but unique key includes them → deleting the top-coded opp permanently broke create/import → dropped the `deletedAt:null` filter.
5. `webhook-url.ts` — SSRF guard missed 127.0.0.0/8, 0.0.0.0/8, hex-mapped IPv6 loopback → rewrote with proper IP range parsing; regression tests added.

Majors fixed:
6. `signatures.ts` — create/void had no permission gate → added `documents:write`.
7. `invoices.payments.ts` — payment currency never checked vs invoice → reject mismatched currency.
8. `rfp-requirement-extract.processor.ts` — extract retry reset `story_match_done` to 0, deduped jobs never re-increment → froze pipeline → COALESCE preserves the counter.
9. `IntakePage.tsx` — auto-advance reported success even when all extractions errored → treat `error` as terminal-failed.
10. `index.css` — undefined `--color-*` tokens broke bg/border/contrast across Calendar/scoring/SMS/Predictive in both themes → added theme-aware aliases.
11. `CalendarPage.tsx` — week-view slot cells mouse-only → role/tabIndex/aria/onKeyDown.
12. `schema.prisma` Activity.idempotencyKey — global unique vs org-scoped dedup → `@@unique([orgId, idempotencyKey])` + migration `20260604000300_activity_idempotency_org_scope`.
13. `company.ts` CompanyPatch — dropped `.url()/.max()` from create path → restored (prevents persist-then-500-on-read).

Verified: all 4 typecheck OK, changed files lint clean, shared 65 + web 248 + worker(touched) 18 tests pass. Residuals (documented): IntakePage cross-run scoping; worker counter could be recomputed from durable state (larger refactor). DB-apply of migration 0300 handed to Tony.

---


Active and resolved issues discovered by AI reviewers. Keep this file current so the next model does not rediscover the same problems.

# PIPELINE-MOVE-001: Draggable anchor broke reliable stage movement

- Severity: High
- State: resolved
- Source: 2026-06-06 Codex pipeline hardening pass
- Owner: Codex
- Files: `apps/web/src/pages/pipelineBoard/PipelineCard.tsx`, `StageColumn.tsx`, `apps/web/e2e/flows/pipeline.spec.ts`, `apps/web/e2e/pages/PipelinePage.ts`
- Problem: Pipeline cards had regressed to draggable route links, violating the repo's existing drag/drop solution note. Browser anchor drag behavior can send a URL instead of the opportunity id, while weak E2E only checked that drag did not throw.
- Fix: Render pipeline cards as explicit draggable controls, suppress post-drag synthetic clicks, navigate via click/Enter, expose stage/card test hooks, and add a reversible E2E that moves a real card with ArrowRight, checks target-column placement, polls persisted API state, then restores the original stage.
- Verification: `pnpm --filter @bidstack/web typecheck`, `pnpm --filter @bidstack/web lint`, focused Playwright `e2e/flows/pipeline.spec.ts`, focused Playwright `e2e/pipeline.spec.ts`, and in-app browser `/pipeline` smoke all passed on 2026-06-06.

# APOLLO-COMPANY-001: Apollo company intelligence must not pull or persist emails/phones

- Severity: High
- State: resolved
- Source: 2026-06-06 Codex Apollo company-intelligence pass
- Owner: Codex
- Files: `apps/worker/src/queues/company-enrich-apollo.ts`, `apps/worker/src/queues/company-enrich-apollo.test.ts`, `packages/shared/src/schemas/crm.entities.ts`, `apps/api/src/services/crm/company-enrichment.service.ts`, `apps/api/src/providers/open-data-connectors.ts`, `apps/web/src/components/settings/IntegrationsSection.tsx`, `apps/web/src/components/cockpit/BusinessSnapshotCard.tsx`, `.env.example`, `docs/solutions/apollo-company-intelligence-privacy-first.md`
- Problem: Apollo enrichment needed to populate account/company intelligence from company data while avoiding emails, phone numbers, and credit-sensitive contact tooling by default.
- Fix: Preferred Apollo MCP company tools, retained REST organization enrichment fallback, removed Apollo People Enrichment entirely for account intelligence, added public-news cross-checking, added news/funding/investment/expansion signals, stripped contact fields before persistence, kept people/executive search explicit opt-in for title-only signals, treated Apollo credit behavior as plan/tool dependent, and surfaced safe defaults in Settings plus sync/news state in the account cockpit.
- Verification: Root `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` pass; Apollo worker tests pass 22/22; open-data connector tests pass 6/6; worker suite passes 211/211; targeted ESLint passes; browser smoke verifies Settings Apollo card with MCP URL, public-news cross-check copy, no People Enrichment env flag, and no console errors.

# DB-SCHEMA-DRIFT-001: Prisma schema/client missing feature models and fields used by API/worker

- Severity: Critical
- State: resolved
- Source: 2026-06-06 Codex gate pass after Apollo implementation
- Owner: Codex
- Files: `packages/db/prisma/schema.prisma`, `apps/api/src/routes/competitors.ts`, `apps/worker/src/queues/competitor-research.ts`, `apps/api/src/routes/rfp-pipeline.ts`, `apps/api/src/services/yjs-merge.service.ts`, `apps/api/src/services/yjs-persistence.service.ts`
- Problem: Full API and worker typechecks fail because source code references Prisma features that are absent from the generated client/schema state: `competitorProfile`, `competitorInsight`, `ReviewIssue.proposalId`, and `YjsDocument.version`.
- Evidence: `pnpm --filter @bidstack/api typecheck` fails in competitor routes, RFP pipeline proposal-scoped review issues, and YJS services. `pnpm --filter @bidstack/worker typecheck` fails on competitor Prisma models. Running `pnpm db:generate` succeeded but did not resolve the drift because the schema itself is missing the referenced contracts.
- Fix: Reconciled `packages/db/prisma/schema.prisma` with the existing new migrations and feature code without editing old migrations. Added `CompetitorProfile` / `CompetitorInsight` models, competitor insight enums, Org/Opportunity relations, `ReviewIssue.proposalId` relation/index, and `YjsDocument.version`, then regenerated Prisma and rebuilt `@bidstack/db`.
- Verification: Prisma schema validation passes; `@bidstack/db build` passes; `@bidstack/api typecheck` passes; `@bidstack/worker typecheck` passes; API/worker lint passes; Apollo worker + safe research tests pass 25/25; shared competitor/SSRF tests pass 27/27; focused API tests pass 7/7; root `pnpm typecheck` passes across the workspace.

# WEB-TEST-001: Exchange-rate fetches leaked into page tests

- Severity: Medium
- State: resolved
- Source: 2026-06-06 Codex gate-noise hardening pass
- Owner: Codex
- Files: `apps/web/src/pages/TerritoriesPage.test.tsx`, `apps/web/src/pages/OpportunitiesPage.test.tsx`, `docs/solutions/test-owned-exchange-rate-fetches.md`
- Problem: Web tests passed but printed happy-dom `AbortError` stacks because page tests rendered money-formatting hooks that start `fetchRates()` on mount.
- Fix: Stubbed settled neutral exchange-rate responses in the affected tests and codified the pattern for future page tests.
- Verification: `pnpm --filter @bidstack/web test` passes with 252/252 tests and no AbortError output.

# MCP-RATE-LIMIT-001: Production MCP rate limits failed open on Redis outage

- Severity: High
- State: resolved
- Source: 2026-06-06 Codex MCP hardening pass
- Owner: Codex
- Files: `apps/mcp-server/src/plugins/hourly-rate-limit.ts`, `apps/mcp-server/src/server.ts`, `apps/mcp-server/src/plugins/hourly-rate-limit.test.ts`, `docs/solutions/mcp-rate-limit-fail-closed-production.md`
- Problem: Both MCP rate limiters allowed requests through when Redis was unavailable. That preserved local availability but let production MCP API keys bypass shared per-minute and hourly budgets during a Redis outage.
- Fix: Added a single `mcpRateLimitFailsClosed()` policy. Production defaults to fail closed; dev/test default to fail open; `MCP_RATE_LIMIT_FAIL_CLOSED=true|false` can override. The custom hourly limiter returns `503` when Redis is unavailable in fail-closed mode, and the Fastify limiter receives the matching `skipOnError` setting.
- Verification: `pnpm --filter @bidstack/mcp-server test`, `typecheck`, and `lint` pass.

# MCP-PROPOSAL-001: Proposal draft MCP tool returned a stub

- Severity: High
- State: resolved
- Source: 2026-06-06 Codex empty-shell MCP review
- Owner: Codex
- Files: `apps/mcp-server/src/tools/proposal-draft.ts`, `apps/mcp-server/src/tools/proposal-draft.test.ts`, `apps/mcp-server/src/tools/tools.test.ts`, `docs/solutions/mcp-proposal-drafts-must-be-grounded.md`
- Problem: `proposal.draft` returned setup instructions and told callers to configure Dust/Anthropic instead of producing usable proposal content.
- Fix: Replaced the placeholder with a deterministic source-grounded builder that uses opportunity data, bounded tasks, contacts, notes, reference-library citations, and `aiOptOut` contact redaction. The output includes evidence used and follow-up checks for human/legal/finance/delivery review.
- Verification: `pnpm --filter @bidstack/mcp-server test` passes with 35/35 tests, including no-stub and contact-redaction assertions; MCP typecheck and lint pass.

# API-BRIEF-001: Opportunity brief endpoint returned a stub

- Severity: High
- State: resolved
- Source: 2026-06-06 Codex empty-shell API review
- Owner: Codex
- Files: `apps/api/src/routes/opportunities.transitions.ts`, `apps/api/src/routes/opportunities.brief.ts`, `apps/api/src/routes/opportunities.brief.test.ts`, `apps/api/src/routes/opportunities.integration.test.ts`, `docs/solutions/opportunity-briefs-must-be-grounded.md`
- Problem: `POST /opportunities/:id/brief` returned "Stub brief generated locally" and setup instructions instead of a usable account-team executive brief.
- Fix: Added a deterministic `crm-grounded-v1` brief builder and wired the route to bounded opportunity tasks, account contacts, account notes, risk focus, and contact opt-out redaction.
- Verification: API brief unit tests and opportunities route integration tests pass (14/14), plus API typecheck and lint.

## RFP-NIM-001: NIM 202 Accepted Treated As Success

- Severity: High
- State: resolved
- Source: 2026-06-04 swarm reviewers
- Owner: Codex
- Files: `apps/worker/src/lib/llm-provider.ts`, `apps/worker/src/lib/llm-provider.test.ts`
- Problem: OpenAI-compatible NIM calls can return HTTP 202 pending; `fetch().ok` would treat it as success and return empty output.
- Fix: Require status 200 and non-empty content for OpenAI-compatible completions.
- Verification: Worker provider tests passed on 2026-06-04.

## RFP-NIM-002: Direct Provider Failure Skipped Dust

- Severity: High
- State: resolved
- Source: 2026-06-04 swarm reviewers
- Owner: Codex
- Files: `apps/worker/src/lib/rfp-llm.ts`, `apps/worker/src/lib/rfp-llm.test.ts`, `apps/worker/src/queues/rfp-requirement-extract.processor.ts`
- Problem: A transient NIM/OpenAI failure could bypass a configured Dust workspace and drop to placeholder or deterministic fallback.
- Fix: Continue into Dust tier after direct-provider errors; require Dust success with output.
- Verification: Worker RFP tiering tests passed on 2026-06-04.

## RFP-NIM-003: NDA-D Gate Ran After Extraction

- Severity: Critical
- State: resolved
- Source: 2026-06-04 cybersecurity and RFP gate reviewers
- Owner: Codex
- Files: `apps/worker/src/queues/rfp-requirement-extract.processor.ts`
- Problem: `ensureExtractedText()` can call OmniParse before `isDocumentAiSafe()`, allowing Tier-D bytes to leave the worker.
- Fix: Move `isDocumentAiSafe()` before source extraction.
- Verification: Worker confidentiality regression test passed on 2026-06-04.

## RFP-EVAL-001: Eval Judge Accepted Malformed Model Output

- Severity: High
- State: resolved
- Source: 2026-06-04 eval reviewers
- Owner: Codex
- Files: `apps/api/src/evals/llm-judge.ts`, `apps/api/src/evals/llm-judge.test.ts`
- Problem: Raw model JSON was parsed without fenced JSON coercion, provider allowlist, or score schema validation.
- Fix: Add provider allowlist, JSON-object coercion, Zod validation for 0-1 scores, NIM 202 and empty-content failures.
- Verification: API eval tests passed on 2026-06-04.

## RFP-CREW-001: Standard Crew Seed Can Drift

- Severity: High
- State: partially_resolved
- Source: 2026-06-04 crew seed reviewers
- Owner: Codex
- Files: `apps/api/src/lib/crew-standard.ts`
- Problem: Retired standard task keys remain active after reseeding; concurrent seeds can race without a uniqueness constraint.
- Fix: Add transaction, per-org advisory lock, and stale task pruning.
- Verification: API typecheck/lint and standard crew constant tests passed on 2026-06-04. Still needs DB integration tests for stale pruning and advisory-lock idempotency.

## RFP-CREW-002: Standard Crew Identity Is Name-Only

- Severity: High
- State: open
- Source: 2026-06-04 crew seed reviewers
- Owner: Unassigned
- Files: `apps/api/src/lib/crew-standard.ts`, Prisma crew schema
- Problem: Without a stable `standardCrewKey` or `is_standard` marker on `crews`, a custom crew named `RFP Response Crew` can collide with the seed workflow.
- Required Fix: Add a new migration with a stable standard crew identifier and unique active `(org_id, standard_key)` index, then seed by key.
- Verification: Add integration tests for custom same-name crew conflict and idempotent standard crew refresh.

## RFP-GATE-001: Approval Route Does Not Fully Gate RFP Orchestration

- Severity: Critical
- State: resolved
- Source: 2026-06-04 product/RFP gate reviewers
- Owner: Claude
- Files: `apps/api/src/routes/rfp-pipeline.ts`, `rfp-pipeline.helpers.ts`, `rfp-pipeline.approve.integration.test.ts`, `rfp-pipeline.test-helpers.ts`
- Problem: Proposal approval set `approvedAt` but never touched the linked `RfpOrchestration`; it stayed `awaiting_approval` so autofill (requires `state='approved'`) was unreachable, and a bid could be approved with open high/critical findings.
- Fix: One transaction — require the orchestration at the final gate (`awaiting_approval` + `qa_review` completed), atomic `updateMany approvedAt:null` approve, conditional orchestration `UPDATE → approved` (row-count asserted), and a **TOCTOU re-check of blockers inside the tx** (review fix). Blockers scoped by `proposalId` (run-scoped).
- Verification: Integration tests cover premature/no-orchestration/drafting-gate/blocked/waived/sibling-run/success. Typecheck + lint green; integration tests `skipIfNoDb` (need live DB).

## RFP-REVIEW-001: Specialist Findings Are Opaque Markdown

- Severity: High
- State: resolved
- Source: 2026-06-04 product/RFP gate reviewers
- Owner: Claude
- Files: `apps/worker/src/queues/rfp-legal-scan.ts`, `__tests__/rfp-review-crew.test.ts`, `schema.prisma` (+ migration `20260604000100_review_issue_proposal_scope`)
- Problem: Legal/Finance/Marketing/Presales/Bid outputs were dumped as markdown into `rfp_orchestrations.config` — unqueryable, no severity/status/owner/waiver.
- Fix: Each role returns a structured JSON finding contract (fail-safe parse); findings persist as first-class `ReviewIssue` rows (`category='rfp-review:<role>'`) — exactly what GATE-001 reads. Idempotent refresh scoped by `proposalId` (new column) so a re-upload can't retire a sibling run's open blockers. Human-triaged issues preserved.
- Verification: 9 worker unit tests (pure parser + row mapper). Persistence path `skipIfNoDb`.

## REVIEW-FINDINGS-001..005: Issues found by the 2026-06-04 adversarial review (all fixed)

- Severity: 3 blocker / 2 major — State: resolved — Owner: Claude
- Source: `bidstack-rfp-competitor-review` workflow (5 lenses, each finding adversarially verified)
- Findings + fixes:
  1. (major) `normalizeUrl` lowercased the whole URL → an invented `/pricing.md` collided with a fetched `/PRICING.md`, defeating cite-or-omit. Fixed: lowercase scheme+host only, keep path/query case; drop default port + userinfo. Regression tests added. (`packages/shared/src/competitor-intel/index.ts`)
  2. (blocker) SSRF via redirect — `redirect:'follow'` chased a 3xx to internal hosts. Fixed: `redirect:'manual'` + re-validate every hop with the SSRF gate (max 4). (`competitor-intel/index.ts`)
  3. (blocker) `isPublicHostname` denylist missed IPv6 ULA/link-local, IPv4-mapped private, and CGNAT `100.64/10`. Fixed (also hardens the existing webhook path). Regression tests added. (`packages/shared/src/utils/webhook-url.ts`, `ssrf.test.ts`)
  4. (blocker) REVIEW-001 retirement scoped by `opportunityId` could clobber a sibling run's open blockers (gate fail-open). Fixed via `proposalId` scoping (see RFP-REVIEW-001).
  5. (major) Competitor migration FK missing `ON DELETE SET NULL` (drift). Fixed in `20260604000000_competitor_intel/migration.sql`.
- Residual (documented, deferred to the worker slice): full DNS-rebinding defence requires the production `fetchImpl` to pin + validate the resolved IP of every hop (undici dispatcher). The string-host gate + manual-redirect re-validation is in place; IP pinning is specified in `docs/competitor-intel.md` and FEAT-COMPETITOR-INTEL below.

## FEAT-COMPETITOR-INTEL: Grounded, cited competitor research (NotebookLM-style)

- Severity: feature — State: COMPLETE (all 3 slices landed; needs DB migrate + optional search key)
- Done (slice 3): `CompetitorIntelPanel` on the RFP pipeline page (`apps/web/src/components/rfp/competitor/CompetitorIntelPanel.tsx`) + `useCompetitorIntel` hooks + `rfp.json` i18n. Cited list (every finding links to its source), add-competitor + Research controls, all states (loading/error/empty/data), one accent, Lucide icons, dark-mode tokens, 44px inputs. Web typecheck + lint green.
- Owner: Claude — Source: 2026-06-04 user request
- Done (slice 1): `@bidstack/shared/competitor-intel` grounded core (cite-or-omit, USASpending cited pricing, SSRF-guarded fetch); `CompetitorProfile`/`CompetitorInsight` schema (`sourceUrl NOT NULL`) + migration `20260604000000_competitor_intel`; `docs/competitor-intel.md`.
- Done (slice 2): `competitor.research` BullMQ queue + processor (`apps/worker/src/queues/competitor-research.ts`) with IP-pinning research fetch (`safe-research-fetch.ts`, 3 tests); untrusted web content wrapped via prompt-safety; API enqueue helper + `competitors.ts` routes (profile CRUD, trigger, insights); registered in worker `main.ts` + `server.routes.ts`. typecheck + lint green; 25 shared cite-or-omit/SSRF tests.
- Open slice (3): `CompetitorInsight` panel on the bid workspace (cited list, Research action, all states, dark mode). Endpoints ready (see `docs/competitor-intel.md`).
- Config: web search needs `COMPETITOR_SEARCH_PROVIDER` + `COMPETITOR_SEARCH_API_KEY` (Tavily); USASpending pricing needs none. Add the 4 env vars to `.env.example` (listed in the design doc — I couldn't edit `.env.example`, it's permission-guarded).

## RFP-CREW-002: Standard Crew Identity Is Name-Only — RESOLVED

- State: resolved — Owner: Claude
- Fix: `crews.standard_key` column + partial unique `crews_org_standard_key_key` (active + non-null, mirrors `crew_agents`); migration `20260604000200_crew_standard_key` (column + earliest-only backfill + index); `seedStandardCrew` matches/refreshes by `STANDARD_CREW_KEY='rfp_response_crew'`, not name.
- Verification: `prisma validate` + `generate` OK; API typecheck + lint green; integration test asserts a same-name custom crew is NOT adopted (`crew-standard.integration.test.ts`, `skipIfNoDb`).

## RFP-CREW-001: Standard Crew Seed Can Drift — RESOLVED (tests added)

- State: resolved — Owner: Claude
- Fix: `crew-standard.integration.test.ts` covers stale-task pruning, advisory-lock idempotency (3 concurrent seeds → one crew, no dup tasks), and the standard_key seed. `skipIfNoDb` — run against a live DB.
