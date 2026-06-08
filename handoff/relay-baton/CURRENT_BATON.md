# Current Baton

## Latest Update - Codex (2026-06-07 Agent Studio Bid Workspace Evidence Handoff)

- Holder: Codex
- Goal slice: Connect Agent Studio crew runs to real persisted bid-workspace
  evidence instead of requiring pasted RFP text only.
- Done:
  - Added an evidence handoff panel inside the Agent Studio crew runner.
  - The panel searches live opportunities, loads
    `GET /api/v1/bid-workspaces/:opportunityId`, shows document and
    requirement counts, links to the RFP pipeline, and can load the evidence
    into the crew run input.
  - Crew inputs now carry `opportunityId`, `documentIds`, `requirementIds`, and
    `evidenceSource=bid_workspace` with the bounded RFP evidence bundle.
  - Added a dedicated formatter that includes document IDs, requirement IDs,
    source chunk IDs, priorities, confidence, and instructions to cite evidence
    and flag blockers.
  - Preserved section line breaks in the generated evidence bundle while
    keeping document, requirement, and total input bounds.
- Verified:
  - `pnpm --filter @bidstack/web exec vitest run src/pages/agentStudio/evidence.test.ts --reporter=dot` - PASS, 2/2.
  - `pnpm --filter @bidstack/web exec eslint src/pages/AgentStudioPage.tsx src/pages/agentStudio/evidence.ts src/pages/agentStudio/evidence.test.ts --quiet` - PASS.
  - `pnpm --filter @bidstack/web typecheck` - PASS.
  - `pnpm --filter @bidstack/web build` - PASS.
  - Browser smoke on `/agent-studio` - PASS: evidence panel opens from `Run`,
    opportunity search returns live records, selected RFP workspace evidence
    fills the crew input, `Run crew` becomes enabled, line breaks are preserved,
    and no app console errors appear.
- Surfaced:
  - Next hard target: close the full RFP loop by proving upload/import from
    Intake/RFP pipeline through OCR/Omniparse extraction, source chunks,
    requirements, Agent Studio run, cited output, and approval gates.
  - Full Twenty parity remains a roadmap item; the current verified slice
    strengthens the AI/workflow foundation rather than claiming all features.

## Latest Update - Codex (2026-06-07 Crew Provider Cancellation Propagation)

- Holder: Codex
- Goal slice: Make Agent Studio/RFP crew cancellation reach the actual
  provider client path, not only the database state.
- Done:
  - Added cooperative `AbortSignal` support to the crew engine and executor
    interface.
  - Passed the signal into the provider-backed crew executor, shared RFP LLM
    wrapper, direct model provider client, and Dust client.
  - Added a worker-side cancellation watcher for active crew runs. If the row
    leaves `running`, the worker aborts the in-flight provider call and refuses
    to persist late results.
  - Kept cancellation telemetry clean: user aborts no longer create fake
    provider-failure warnings or AI invocation error records.
  - Preserved provider-neutral RFP execution for Dust, Claude, OpenAI, Kimi,
    NVIDIA NIM, and Gemma/local OpenAI-compatible providers.
- Verified:
  - `pnpm --filter @bidstack/worker exec vitest run src/crew/engine.test.ts src/crew/dust-executor.test.ts src/lib/rfp-llm.test.ts src/lib/llm-provider.test.ts --reporter=dot` - PASS, 49/49.
  - `pnpm --filter @bidstack/dust-client exec vitest run src/client.test.ts --reporter=dot` - PASS, 3/3.
  - Focused worker and Dust client eslint - PASS.
  - `pnpm --filter @bidstack/dust-client build` - PASS.
  - `pnpm --filter @bidstack/dust-client typecheck` - PASS.
  - `pnpm --filter @bidstack/worker typecheck` - PASS.
  - `pnpm --filter @bidstack/web build` - PASS.
  - Browser smoke on `/agent-studio` - PASS: provider readiness renders `2/6
    ready`, no visible request/load error after reload, and sticky sidebar/topbar
    stay pinned after bottom scroll.
- Surfaced:
  - The next important RFP workflow slice is Intake/OCR evidence handoff:
    document IDs, extracted chunks, requirements, and citations need to feed
    crew-run inputs directly.
  - Full Twenty parity is not complete. The verified foundation now covers
    provider-neutral agents, readiness, recovery controls, and cancellation.

## Latest Update - Codex (2026-06-07 Crew Run Recovery Controls)

- Holder: Codex
- Goal slice: Make Agent Studio crew execution recoverable and state-safe, not
  just fire-and-forget.
- Done:
  - Added `POST /api/v1/crew-runs/:id/cancel` for queued/running runs with
    owner-or-admin scoping and audit evidence.
  - Added `POST /api/v1/crew-runs/:id/retry` for failed/cancelled/partial runs,
    replaying the stored bounded inputs into a new queued run.
  - Added producer-side queued-job removal for BullMQ jobs that have not become
    active yet.
  - Hardened the worker state machine so it only claims `queued` runs and only
    writes final results while the run is still `running`; cancelled runs cannot
    be overwritten by late completions.
  - Wired Agent Studio history actions: Cancel active runs, Retry failed or
    cancelled runs, and Run again for completed runs.
  - Added `/api/v1/crew-runs` to mutation-audit safety-net coverage.
- Verified:
  - `pnpm --filter @bidstack/api exec vitest run src/routes/crews.integration.test.ts src/routes/agents.integration.test.ts --reporter=dot` - PASS, 8/8.
  - Focused API/worker/web lint - PASS.
  - `pnpm --filter @bidstack/api typecheck` - PASS.
  - `pnpm --filter @bidstack/worker typecheck` - PASS.
  - `pnpm --filter @bidstack/web typecheck` - PASS.
  - `pnpm --filter @bidstack/web build` - PASS.
  - In-app browser smoke on `/agent-studio` - PASS: page loads, sticky shell is
    anchored, crew runner opens, and Intake/Run Crew/Run History states render.
- Surfaced:
  - Cancellation is data-safe, but provider calls already in flight are not
    physically aborted yet. Next backend hardening should pass `AbortSignal`
    through the crew executor and Dust/direct model adapters.

## Latest Update - Codex (2026-06-07 Agent Provider Readiness Status)

- Holder: Codex
- Goal slice: Make Agent Studio and Settings show which AI/MCP model providers
  are actually ready without leaking API keys.
- Done:
  - Added shared provider-readiness schemas for Dust, Claude, OpenAI, Kimi,
    NVIDIA NIM, and Gemma/local providers.
  - Added `GET /api/v1/agents/provider-status`, gated by `agents:read`, with
    setup source, model, endpoint, missing env keys, and provider notes.
  - Added `useAgentProviderStatus()` and a reusable `AgentProviderStatusCard`.
  - Rendered the readiness card in `/agent-studio` and Settings ->
    Integrations -> AI & Agents.
  - Preserved secret safety: API keys are not serialized; Dust keeps its
    encrypted org credential path, and direct providers remain server-side
    env/Azure secret-backed for this slice.
- Verified:
  - `pnpm --filter @bidstack/shared build` - PASS.
  - `pnpm --filter @bidstack/api exec vitest run src/services/agents/agents.helpers.test.ts --reporter=dot` - PASS, 4/4.
  - `pnpm --filter @bidstack/shared exec vitest run src/schemas/rfp-agent.test.ts --reporter=dot` - PASS, 4/4.
  - Focused API/web lint - PASS.
  - `pnpm --filter @bidstack/api typecheck` - PASS.
  - `pnpm --filter @bidstack/web typecheck` - PASS.
  - `pnpm --filter @bidstack/web build` - PASS.
  - Direct local `/api/v1/agents/provider-status` route check - PASS.
  - In-app browser smoke on `/agent-studio` - PASS.
  - In-app browser smoke on Settings -> Integrations -> AI & Agents - PASS.
- Surfaced:
  - Build `@bidstack/shared` before API consumer tests when shared schemas
    change.
  - Tests that assert missing env must explicitly clear their owned env keys.
  - Next high-value follow-up: encrypted per-org direct-provider credentials in
    Settings, backed by Azure Key Vault or the existing credential encryption
    pattern.

## Latest Update - Codex (2026-06-07 Agent Studio Provider-Neutral Crew UX)

- Holder: Codex
- Goal slice: Improve `/agent-studio` as a user-friendly, provider-neutral RFP
  automation control tower while fixing the sticky sidebar/hamburger regression.
- Done:
  - Added an RFP automation control tower to `/agent-studio` with Intake,
    OCR/parse, agent crew, and approval steps.
  - Added operational state metrics for current agents, standard agents, crews,
    and the direct-provider -> Dust -> manual-review posture.
  - Added run-panel guidance linking file-based RFP work to `/intake` before
    crew execution, while preserving pasted extracted text for direct crew runs.
  - Removed the sidebar inline positioning override so desktop navigation and
    the collapse/hamburger control remain sticky on long pages.
  - Extended RFP agent providers to Dust, Claude, OpenAI, Kimi, NVIDIA NIM, and
    Gemma/local OpenAI-compatible endpoints.
  - Added an OpenAI-compatible API adapter with provider-specific env contracts,
    typed response validation, safe missing-credential errors, and no secret
    exposure in the client.
  - Updated the agent dialog and starter templates so admins can choose provider
    and model without vendor lock-in.
  - Added `docs/solutions/agent-studio-provider-neutral-crew-ux.md` and updated
    the relay issue/lesson records.
- Twenty research:
  - Inspected Twenty's open-source repo/docs for the product shape: agents and
    skills as first-class primitives, command-menu discoverability, permissions,
    and app extension objects. No Twenty code was copied.
- Verified:
  - `pnpm --filter @bidstack/web exec eslint src/pages/AgentStudioPage.tsx src/components/layout/Sidebar.tsx src/components/agents/AgentDialog.tsx src/pages/AgentsPage.tsx src/pages/agents/AgentsStarterGrid.tsx src/pages/agents/AgentsSquadTable.tsx e2e/navigation.spec.ts --quiet` - PASS.
  - `pnpm --filter @bidstack/web typecheck` - PASS.
  - `pnpm --filter @bidstack/web build` - PASS.
  - `pnpm --filter @bidstack/api exec vitest run src/services/agents/agents.helpers.test.ts --reporter=dot` - PASS, 2/2.
  - `pnpm --filter @bidstack/shared exec vitest run src/schemas/rfp-agent.test.ts --reporter=dot` - PASS, 4/4.
  - In-app browser smoke on `http://localhost:5173/agent-studio` - PASS:
    control tower rendered, run panel showed Intake/OCR guidance, sticky sidebar
    stayed pinned after scroll, and no fatal console errors appeared.
  - `pnpm --filter @bidstack/web exec playwright test e2e/navigation.spec.ts --grep "desktop sidebar toggle remains anchored while scrolling long pages"` - PASS.
- Surfaced:
  - This slice does not claim full Twenty parity across every CRM module.
  - No live provider call was made; real keys must stay server-side in local env
    or Azure secrets.
  - The workspace remains broadly dirty from earlier CRM stabilization shifts;
    do not revert unrelated files.

## Latest Update - Codex (2026-06-07 RBAC Role Mutation Rich Audit Coverage)

- Holder: Codex
- Goal slice: Make audit logging rock solid for admin role and permission changes.
- Done:
  - `/api/v1/roles` create now writes `role.create` inside the create transaction.
  - `/api/v1/roles/:id` patch now writes `role.update` inside the update transaction with before/after role and permission evidence.
  - `/api/v1/roles/:id` delete now writes `role.delete` inside the soft-delete transaction.
  - Role audit diffs include actor kind, role name, description, permission IDs, permission keys, requested fields, changed fields, and before/after permission changes where applicable.
  - POST role creation now validates every permission ID before creating role-permission joins.
  - PATCH de-duplicates repeated permission IDs and role-permission replacement deletes are scoped by `orgId`.
  - The mutation-audit safety net now skips rich-audited role CRUD paths to avoid duplicate `http.mutation.success` rows.
  - Added integration coverage for the full role create/update/delete audit lifecycle and duplicate generic request prevention.
- Verified:
  - `pnpm --filter @bidstack/api exec vitest run src/routes/roles.integration.test.ts src/plugins/mutation-audit.test.ts --reporter=dot` - PASS, 31/31.
  - `pnpm --filter @bidstack/api exec eslint src/routes/roles.ts src/routes/roles.integration.test.ts src/plugins/mutation-audit.ts src/plugins/mutation-audit.test.ts --quiet` - PASS.
  - `pnpm --filter @bidstack/api typecheck` - PASS.
  - `pnpm --filter @bidstack/api test` - PASS, 73 files / 522 passed / 2 skipped.
  - `pnpm --filter @bidstack/api build` - PASS.
- Surfaced:
  - Full API tests logged slow dashboard/widget queries during unrelated tests. Keep that for the broader performance hardening pass.
  - Other safety-net route families still need review for promotion to rich domain before/after audit rows.

## Latest Update - Codex (2026-06-07 Company CRUD Rich Audit Coverage)

- Holder: Codex
- Goal slice: Promote high-value company/account mutations from generic request evidence to rich transaction-level audit rows.
- Done:
  - `/api/v1/companies` create now writes `company.create` inside the create transaction.
  - `/api/v1/companies/:id` patch now writes `company.update` inside the update/custom-field transaction with before/after business diffs.
  - `/api/v1/companies/:id` delete now writes `company.delete` inside the soft-delete transaction.
  - Tax ID and arbitrary custom-field values are not dumped raw into the audit diff; the audit records that they changed and records custom-field definition IDs/counts.
  - The mutation-audit safety net now skips rich-audited company CRUD paths to avoid duplicate `http.mutation.success` rows.
  - Added `apps/api/src/routes/companies.test.ts` for create/update/delete audit behavior and duplicate-safety-net prevention.
- Verified:
  - `pnpm --filter @bidstack/api exec vitest run src/routes/companies.test.ts src/plugins/mutation-audit.test.ts src/routes/audit-logs.test.ts --reporter=dot` - PASS, 25/25.
  - `pnpm --filter @bidstack/api exec eslint src/routes/companies.ts src/routes/companies.test.ts src/plugins/mutation-audit.ts src/plugins/mutation-audit.test.ts --quiet` - PASS.
  - `pnpm --filter @bidstack/api typecheck` - PASS.
  - `pnpm --filter @bidstack/api test` - PASS, 73 files / 517 passed / 2 skipped.
- Surfaced:
  - Other route families still covered only by the request-level safety net should be reviewed and promoted when they need exact domain before/after diffs.

## Latest Update - Codex (2026-06-07 Audit Log Evidence Export Hardening)

- Holder: Codex
- Goal slice: Make the Audit Log Excel export rock solid for compliance reviewers and strengthen request-source evidence captured by the backend.
- Done:
  - Added first-class XLSX columns for actor kind, related CRM ids, request id, HTTP method, HTTP path, route, status code, source IP, and user agent.
  - Kept raw diff JSON and diff summary in the workbook so forensic detail remains available.
  - Updated the mutation-audit safety net to capture request IP and user agent without recording request bodies or query strings.
  - Fixed the export collector so `Truncated by limit` is marked `yes` when the limit is reached inside a fetched batch.
  - Updated `docs/solutions/audit-log-server-side-xlsx-export.md`, `PROGRESS.md`, `MISTAKES.md`, and this baton.
- Verified:
  - `pnpm --filter @bidstack/api exec vitest run src/routes/audit-logs.test.ts src/plugins/mutation-audit.test.ts --reporter=dot` - PASS, 22/22.
  - `pnpm --filter @bidstack/api exec eslint src/routes/audit-logs.ts src/routes/audit-logs.test.ts src/plugins/mutation-audit.ts src/plugins/mutation-audit.test.ts --quiet` - PASS.
  - `pnpm --filter @bidstack/api typecheck` - PASS.
  - `pnpm --filter @bidstack/api test` - PASS, 72 files / 514 passed / 2 skipped.
- Surfaced:
  - Safety-net audit rows are request-level evidence. High-value domain routes should still get transaction-level audit rows with precise before/after business diffs.
  - Sub-agent spawn was unavailable because the thread limit was already reached.

## Latest Update - Codex (2026-06-07 Audit Mutation Safety Net)

- Holder: Codex
- Goal slice: Make Audit Log coverage more solid by adding backend evidence for authenticated mutations that do not yet have rich domain audit rows.
- Done:
  - Added `apps/api/src/plugins/mutation-audit.ts` and registered it in `apps/api/src/server.ts`.
  - Added `apps/api/src/plugins/mutation-audit.test.ts`.
  - Safety-net rows use `http.mutation.success` and `http.mutation.denied` with `targetType: http_request`.
  - The safety net strips query strings, never stores request bodies, and stores API-key pseudo users as `userId: null` with the actor id in `diff.actorId`.
  - Scoped the safety net to currently unaudited route families to avoid duplicate audit rows on rich-audited hot paths.
  - Expanded coverage after a Fastify route inventory to include comments, mentions, calls, signatures, forecasts, lead routing, admin actions, edit locks, migration mappings, email/SMS sends, booking pages, service cases, and integration connect/disconnect/resync routes.
  - Intentionally kept `/api/v1/presence` out of audit logging because high-volume heartbeats would bury compliance evidence at 50k-user scale.
  - Refined `/api/v1/companies` safety-net behavior: manual company CRUD remains covered, while rich-audited `/api/v1/companies/:id/tier` is skipped to avoid duplicate `company.tier.update` request rows.
  - Fixed repeat-run API gate failures by keeping `@fastify/rate-limit` counters in-memory for `NODE_ENV=test` and making penetration-test opportunity codes UUID-backed.
  - Added `docs/solutions/mutation-audit-safety-net.md`, updated `PROGRESS.md`, and logged the initial over-broad design, route-inventory shell mistake, Redis rate-limit leakage, and random-code fixture collision in `MISTAKES.md`.
- Verified:
  - `pnpm --filter @bidstack/api exec vitest run src/routes/crm/companies.test.ts src/security/penetration.access-control.test.ts src/plugins/mutation-audit.test.ts src/routes/audit-logs.test.ts --reporter=dot` - PASS, 39/39.
  - `pnpm --filter @bidstack/api exec eslint src/server.ts src/security/penetration.test-helpers.ts src/plugins/mutation-audit.ts src/plugins/mutation-audit.test.ts --quiet` - PASS.
  - `pnpm --filter @bidstack/api typecheck` - PASS.
  - Audit-sensitive API route suite - PASS, 56/56.
  - `pnpm --filter @bidstack/api build` - PASS.
  - `pnpm --filter @bidstack/api test` - PASS, 72 files / 513 passed / 2 skipped.
  - `pnpm --filter @bidstack/web exec playwright test e2e/audit-log.spec.ts --reporter=line` - PASS, 5 passed / 1 skipped.
  - `pnpm e2e` - PASS before the expanded safety-net allowlist patch.
- Surfaced:
  - Full root gates were not rerun after the expanded backend safety-net allowlist patch.
  - Safety-net audit is not a replacement for rich atomic audit on high-value domain mutations.

## Latest Update - Codex (2026-06-07 Web Bundle Gate Noise)

- Holder: Codex
- Goal slice: Keep pushing CRM production readiness after the Audit Log slice by removing the next verified release-gate noise source.
- Done:
  - Ran a broad web CRM route sweep covering smoke, navigation, accounts, account detail, contacts, leads, opportunities, pipeline, intake, integrations, settings, service desk, tasks, invoices, and reports.
  - Isolated `lucide-react` into a narrow `icons` manual chunk in `apps/web/vite.config.ts`.
  - Preserved existing dirty `/livez` and `/readyz` proxy edits in the same file.
  - Updated `docs/solutions/production-gate-noise.md`, `PROGRESS.md`, and `MISTAKES.md`.
- Verified:
  - Broad CRM E2E sweep - PASS, 58/58.
  - `pnpm --filter @bidstack/web build` - PASS with no oversized chunk warning.
  - `pnpm --filter @bidstack/web exec playwright test e2e/performance/bundle-size-budget.spec.ts --reporter=line` - PASS, 4/4.
  - `pnpm --filter @bidstack/web typecheck` - PASS.
  - `pnpm --filter @bidstack/web exec eslint vite.config.ts --quiet` - PASS.
  - `pnpm --filter @bidstack/web exec playwright test e2e/smoke.spec.ts e2e/navigation.spec.ts --reporter=line` - PASS, 9/9.
- Surfaced:
  - Full root gates were not rerun after this focused chunk split.
  - Next useful sweep: API/MCP/worker route coverage and empty-shell action detection, especially around audit coverage for all mutations.

## Latest Update - Codex (2026-06-07 Audit Log Hardening)

- Holder: Codex
- Goal slice: Make the Audit Log rock solid enough for compliance evidence exports.
- Done:
  - Added `GET /api/v1/audit-logs/export.xlsx` as a server-side Excel export.
  - Export is tenant-scoped, filters server-side, uses `deletedAt: null`, bounds rich scans, neutralizes Excel formula prefixes, and returns `Cache-Control: private, no-store`.
  - Export writes `audit_log.export.xlsx` back into the audit log with requester, filters, exported row count, scanned row count, and truncation status.
  - Workbook includes `Export Metadata` and `Audit Log` sheets.
  - UI primary action is now `Export Excel`; old current-page CSV remains as secondary `Visible CSV`.
- Verified:
  - `pnpm --filter @bidstack/shared build` - PASS.
  - `pnpm --filter @bidstack/shared typecheck` - PASS.
  - `pnpm --filter @bidstack/api typecheck` - PASS.
  - `pnpm --filter @bidstack/api exec vitest run src/routes/audit-logs.test.ts --reporter=dot` - PASS, 4/4.
  - `pnpm --filter @bidstack/web typecheck` - PASS.
  - `pnpm --filter @bidstack/web exec playwright test e2e/audit-log.spec.ts --reporter=line` - PASS, 5 passed / 1 skipped.
  - Live proxy workbook parse - PASS.
  - In-app browser smoke on `/settings?tab=audit-log` - PASS, no console errors.
- Surfaced:
  - Codex in-app browser cannot observe download events; download verification used live HTTP workbook parsing and Playwright e2e.
  - Full root gates were not rerun for this focused slice.

## Latest Update - Codex (2026-06-07 07:45 America/New_York)

- Holder: Codex
- Goal slice: Close the remaining dependency audit advisories and recheck Tony's affected account cockpit path live.
- Done:
  - Ran the full dependency audit payload after the high-severity gate was green and confirmed three moderate advisories remained.
  - Patched direct frontend dependencies for `i18next-http-backend` and `react-router-dom`.
  - Added a workspace `ws` override for compatible transitive websocket consumers.
  - Ran `pnpm install` and recorded that the lockfile refresh happened in an already-dirty workspace.
  - Added `docs/solutions/dependency-audit-zero-advisory-remediation.md` and logged the mistake.
  - Rechecked the affected cockpit endpoint and page after the dependency pass.
  - Cleaned only the trailing whitespace lines reported by `git diff --check`.
- Verified:
  - `pnpm audit` PASS with no known vulnerabilities.
  - `pnpm lint` PASS.
  - `pnpm typecheck` PASS.
  - `pnpm test` PASS, including API 71 files / 495 passed / 2 skipped.
  - `pnpm build` PASS.
  - Focused web, marketing, and API typechecks passed.
  - Focused web and marketing tests passed.
  - Live `/readyz` PASS with DB, Redis, and storage true.
  - Live Vite-proxied account cockpit request for `20086dc4-4ac4-441b-9c30-b33abdcca98d` returned `200`.
  - In-app browser smoke on the affected account page showed real account content, no fatal cockpit error text, no `Request failed (500)`, and no console errors.
  - `git diff --check` PASS except expected Windows line-ending warnings.
- Surfaced:
  - `pnpm install` still warns about an `@eslint/js` 10 / ESLint 9 peer mismatch.
  - The web build succeeds with a Vite warning for a vendor chunk above 700 kB.
  - The worktree remains broadly dirty from prior CRM stabilization work; do not revert unrelated changes.

## Latest Update - Codex (2026-06-07 06:55 America/New_York)

- Holder: Codex
- Goal slice: Continue full CRM stabilization by running broad root gates and fixing the next verified failure.
- Done:
  - Ran `pnpm audit --audit-level high`, `pnpm lint`, and `pnpm typecheck`; all passed. Audit still reports 3 moderate advisories.
  - Ran root `pnpm test`; first run failed in `apps/api/src/routes/opportunities.integration.test.ts`.
  - Diagnosed the failure: RFP approval tests can create valid `RFP-*` opportunities while API test files run in parallel, so the opportunities list head is not guaranteed to be an `OP-NNNN` seed fixture.
  - Updated the list test to validate the tolerant persisted-read shape for the page head, then find a canonical seed opportunity by DB identity and verify it through a scoped search.
  - Added `docs/solutions/opportunity-list-tests-must-not-assume-order.md` and logged the mistake.
- Verified:
  - `pnpm --filter @bidstack/api exec vitest run src/routes/opportunities.integration.test.ts --reporter=dot` PASS, 12/12.
  - `pnpm --filter @bidstack/api typecheck` PASS.
  - `pnpm --filter @bidstack/api lint` PASS.
  - `pnpm test` PASS, including API 71 files / 495 passed / 2 skipped.
  - `pnpm build` PASS.
- Surfaced:
  - Root audit high gate is green, but 3 moderate advisories remain.
  - API integration tests still share a seed org; isolated test tenants would be a better enterprise-grade long-term test foundation.

## Latest Update - Codex (2026-06-07 06:35 America/New_York)

- Holder: Codex
- Goal slice: Confirm the cockpit fix under full browser validation and remove a real E2E data-pollution source instead of masking it with bad snapshots.
- Done:
  - Confirmed the latest full web E2E run passed via `apps/web/test-results/.last-run.json`.
  - Traced earlier contact/responsive visual diffs to meeting-import tests writing contacts and related artifacts into the shared seed org.
  - Added `apps/web/e2e/fixtures/test-data-cleanup.ts` to remove only explicit meeting-import fingerprints (`E2E Buyer`, `Attendees:`, `Risk:`, `Meeting Import`) from browser tests.
  - Wired cleanup into account, contact, and responsive baseline tests.
  - Added API notes-test cleanup for matching contacts, notes, risks, tasks, and enrichment rows.
  - Verified the Settings responsive baselines after confirming the contacts baseline was data pollution, not a design change.
  - Logged the mistake and created `docs/solutions/e2e-meeting-import-test-artifacts.md`.
- Verified:
  - `pnpm --filter @bidstack/web e2e` PASS according to `.last-run.json`.
  - `pnpm --filter @bidstack/web typecheck` PASS.
  - `pnpm --filter @bidstack/web lint` PASS.
  - `pnpm --filter @bidstack/api typecheck` PASS.
  - `pnpm --filter @bidstack/api exec vitest run src/routes/notes.test.ts --reporter=dot` PASS, 7/7.
- Surfaced:
  - Shared seed-org E2E data remains a systemic risk. The current cleanup is intentionally narrow; future mutating E2E suites should use isolated tenants or a safe reset endpoint.
  - The repo remains broadly dirty from prior sweeps. Do not revert unrelated files.

## Latest Update - Codex (2026-06-07 05:41 America/New_York)

- Holder: Codex
- Goal slice: Close the repeated idle account cockpit crash path after Tony saw `Request failed (500)` again on `GET /api/v1/crm/dashboard?account=20086dc4-4ac4-441b-9c30-b33abdcca98d`.
- Done:
  - Rechecked the exact endpoint through both Vite proxy and the API; it currently returns `200` and selects `Rush University System for Health`.
  - Confirmed `/readyz` returns `200` with DB, Redis, and storage healthy.
  - Found the earlier stale-refresh fix only protected React Query's in-memory data. It did not survive browser tab discard/reload after a long idle.
  - Added a tab-scoped, schema-validated account cockpit fallback in `DashboardPage.tsx`.
  - Fallback is used only for transient 5xx/network dashboard failures; 404/missing accounts still render the fatal error.
  - Cleared the tab-local cockpit fallback from the existing auth cache cleanup path.
  - Added regression tests for 5xx fallback, 404 no-fallback, and auth/cache cleanup.
  - Codified the lesson in `docs/solutions/account-cockpit-tab-discard-fallback.md` and logged the mistake in `MISTAKES.md`.
- Verified:
  - `pnpm --filter @bidstack/web exec vitest run src/pages/DashboardPage.test.tsx src/lib/queryCache.test.ts --reporter=dot` PASS, 8/8.
  - `pnpm --filter @bidstack/web typecheck` PASS.
  - `pnpm --filter @bidstack/web lint` PASS.
  - `pnpm --filter @bidstack/api exec vitest run src/routes/crm/dashboard.test.ts --reporter=dot` PASS, 5/5.
  - Live `GET /readyz` returned `200` with `{"ok":true,"db":true,"redis":true,"storage":true}`.
  - Live Vite-proxied account dashboard returned `200` and selected `Rush University System for Health`.
  - In-app browser smoke on `http://localhost:5173/accounts/20086dc4-4ac4-441b-9c30-b33abdcca98d?qa=idle-session-fallback` showed account content, no fatal cockpit error, no `Request failed (500)` copy, and no console errors.
- Surfaced:
  - Multiple local API/web dev watcher processes exist, though only one API process owns port `4000`. Local dev reliability will be cleaner if duplicate watchers are consolidated in a future ops cleanup.
  - Full root gates were not rerun for this narrow frontend resilience patch.

## Latest Update - Codex (2026-06-07 05:07 America/New_York)

- Holder: Codex
- Goal slice: Fix Tony's idle account cockpit 500 and close the full API regressions surfaced during validation.
- Done:
  - Rechecked `GET /api/v1/crm/dashboard?account=20086dc4-4ac4-441b-9c30-b33abdcca98d` through API and Vite proxy.
  - Fixed API Redis readiness recovery by adding `ensureRedisReady()` and `pingRedis()` around fail-fast ioredis clients.
  - Routed readiness and cache get/set/delete through the Redis reconnect helper before memory fallback.
  - Found and fixed a separate opportunities read-contract bug in the full API gate: persisted legacy/RFP/test/imported codes outside `OP-NNNN` no longer crash opportunity reads.
  - Kept write/import-supplied opportunity codes strict via `CanonicalOpportunityCode`.
  - Added Redis helper tests, shared opportunity schema tests, and reusable solution notes for both patterns.
- Verified:
  - `pnpm --filter @bidstack/api exec vitest run src/redis.test.ts src/routes/health.test.ts src/plugins/redis-cache.test.ts --reporter=dot` PASS, 11/11.
  - `pnpm --filter @bidstack/api exec vitest run src/routes/crm/dashboard.test.ts --reporter=dot` PASS, 5/5.
  - `pnpm --filter @bidstack/web exec vitest run src/pages/DashboardPage.test.tsx --reporter=dot` PASS, 3/3.
  - `pnpm --filter @bidstack/shared build` PASS.
  - `pnpm --filter @bidstack/shared test` PASS, 10 files / 66 tests.
  - `pnpm --filter @bidstack/api exec vitest run src/routes/opportunities.integration.test.ts --reporter=dot` PASS, 12/12.
  - `pnpm --filter @bidstack/api exec vitest run src/routes/rfp-pipeline.approve.integration.test.ts --reporter=dot` PASS, 12/12.
  - `pnpm --filter @bidstack/api typecheck` PASS.
  - `pnpm --filter @bidstack/api lint` PASS.
  - `pnpm --filter @bidstack/api test` PASS, 71 files / 495 passed / 2 skipped.
  - Live `GET /readyz` returned `200` with DB, Redis, and storage true.
  - Live Vite proxy request for the affected account dashboard returned `200`.
  - Live Vite proxy request for opportunities returned `200`.
  - Playwright smoke on `http://localhost:5173/accounts/20086dc4-4ac4-441b-9c30-b33abdcca98d?qa=idle-crash-regression` showed account content, no fatal cockpit error, no `Request failed (500)` copy, and no console errors.
- Surfaced:
  - Full root gates were not rerun for this slice. Full API/shared gates plus live browser/API checks are green.
  - Keep watching the known full-E2E residuals from the previous sweep: account notes import UI and dense accessibility/route-contract issues.

## Latest Update - Codex (2026-06-07 04:58 America/New_York)

- Holder: Codex
- Goal slice: Fix the idle account cockpit 500 pattern at the API readiness/cache foundation.
- Done:
  - Rechecked Tony's failing endpoint: `GET /api/v1/crm/dashboard?account=20086dc4-4ac4-441b-9c30-b33abdcca98d`.
  - Confirmed the dashboard endpoint itself returned `200`, but `/readyz` was stuck at `503` with `redis:false` while Redis was reachable on `localhost:6380`.
  - Added `ensureRedisReady()` and `pingRedis()` in the API Redis helper so fail-fast Redis clients can recover from ended/closed idle states.
  - Routed API cache get/set/delete through the reconnect helper before falling back to the in-memory cache.
  - Routed `/readyz` and `/health` Redis checks through `pingRedis()`.
  - Added Redis status-helper tests and a reusable solution note.
- Verified:
  - `pnpm --filter @bidstack/api exec vitest run src/redis.test.ts src/routes/health.test.ts src/plugins/redis-cache.test.ts --reporter=dot` PASS, 11/11.
  - `pnpm --filter @bidstack/api exec vitest run src/routes/crm/dashboard.test.ts --reporter=dot` PASS, 5/5.
  - `pnpm --filter @bidstack/web exec vitest run src/pages/DashboardPage.test.tsx --reporter=dot` PASS, 3/3.
  - `pnpm --filter @bidstack/api typecheck` PASS.
  - `pnpm --filter @bidstack/api lint` PASS.
  - Live `GET /readyz` returned `200` with DB, Redis, and storage true.
  - Live Vite proxy request for the affected account dashboard returned `200`.
  - In-app browser smoke on `http://localhost:5173/accounts/20086dc4-4ac4-441b-9c30-b33abdcca98d?qa=idle-redis-reconnect` showed the account, no fatal cockpit error, no `Request failed (500)` copy, and no console errors.
- Surfaced:
  - Full root gates were not rerun for this small API runtime patch.
  - Keep watching the known full-E2E residuals from the previous sweep: account notes import UI and dense accessibility/route-contract issues.

## Latest Update - Codex (2026-06-07 04:10 America/New_York)

- Holder: Codex
- Goal slice: Fix the account cockpit crash pattern after an idle/stale refresh and enforce weekly Apollo account-intelligence freshness.
- Done:
  - Reproduced the affected cockpit API path directly through API and Vite proxy for account `20086dc4-4ac4-441b-9c30-b33abdcca98d`.
  - Changed the account cockpit/dashboard page to keep rendering the last verified snapshot when a background refresh fails, instead of replacing useful data with the fatal "Couldn't load the CRM cockpit" state.
  - Added an inline live-refresh warning with Retry when stale data is still usable.
  - Added account-page auto-refresh triggering for missing or stale Apollo strategic intelligence, bounded by a per-page attempt set so the UI does not spam Redis/Apollo queues.
  - Recomputed Apollo strategic-intel freshness from `lastSyncedAt` at serialization time, so a stored `freshness: "fresh"` flag cannot remain fresh forever.
  - Reduced local/company enrichment and Apollo worker cache TTLs to seven days to match the weekly refresh requirement.
  - Fixed a notes panel unused-prop lint issue by surfacing account/domain context in the card caption.
  - Fixed a web test bootstrap issue by importing `@/i18n` in the currency selector test.
  - Fixed DB script lint by removing CommonJS `require()` and `console.log` usage without running the script.
- Verified:
  - Direct API/proxy check for `/api/v1/crm/dashboard?account=20086dc4-4ac4-441b-9c30-b33abdcca98d` returned 200 with cockpit data.
  - Browser smoke on `http://localhost:5173/accounts/20086dc4-4ac4-441b-9c30-b33abdcca98d` showed the cockpit, no fatal error, and no console errors.
  - `pnpm --filter @bidstack/web exec vitest run src/pages/DashboardPage.test.tsx` PASS, 3/3.
  - `pnpm --filter @bidstack/api exec vitest run src/services/crm/company.service.test.ts src/services/crm/company-enrichment.service.test.ts` PASS, 4/4.
  - `pnpm --filter @bidstack/worker exec vitest run src/queues/company-enrich-apollo.test.ts` PASS, 22/22.
  - `pnpm --filter @bidstack/web test` PASS, 39 files / 255 tests.
  - `pnpm --filter @bidstack/api test` PASS, 70 files / 493 passed / 2 skipped.
  - `pnpm --filter @bidstack/worker test` PASS, 19 files / 211 tests.
  - `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` all PASS.
- Surfaced:
  - No live Apollo vendor request was made. Real Apollo MCP/OAuth/API credentials must stay server-side in local env or Azure secrets, and the worker must be running for queued stale accounts to populate.
  - The affected account currently renders as "Apollo not synced" until credentials and worker runtime complete the first sync.
  - The worktree remains broadly dirty from prior CRM sweeps; do not revert unrelated changes.

## Latest Update - Codex (2026-06-07 00:25 America/New_York)

- Holder: Codex
- Goal slice: Continue Salesforce-level hardening by closing an Apollo account-intelligence lifecycle gap.
- Done:
  - Audited company/account enrichment callers after the Apollo MCP privacy pass.
  - Found that `POST /api/crm/companies/:id/enrich` queued Apollo verification, but `autopopulateCompanies()` only wrote local verified company cache rows and skipped Apollo queue fan-out.
  - Centralized direct enrich route queueing through `queueApolloEnrichment()`.
  - Added Apollo queue fan-out after each newly enriched autopopulated company, while preserving the fresh-cache skip path so Apollo/Redis are not abused.
  - Updated stale web hook documentation that incorrectly said the Dust worker refreshed Apollo.
  - Added unit coverage for both invariants: newly enriched autopopulated companies queue Apollo; fresh cached companies do not.
- Verified:
  - `pnpm --filter @bidstack/api exec vitest run src/services/crm/company.service.test.ts --reporter=dot` PASS, 2/2.
  - `pnpm --filter @bidstack/api exec tsc --noEmit` PASS.
  - Targeted ESLint on company service, route, service test, and `useEnrichCompany.ts` PASS.
  - `pnpm --filter @bidstack/api test` PASS, 69 files / 491 passed / 2 skipped.
  - `pnpm --filter @bidstack/web exec tsc --noEmit` PASS.
  - Root `pnpm lint` PASS.
  - Root `pnpm typecheck` PASS.
  - Root `pnpm test` PASS.
  - Root `pnpm build` PASS.
- Surfaced:
  - No live Apollo vendor request was made. Tests prove queue fan-out and cache behavior only.
  - API integration tests enqueue local BullMQ jobs when Redis is available; enqueue failures remain fail-soft for route availability.

## Latest Update - Codex (2026-06-07 00:07 America/New_York)

- Holder: Codex
- Goal slice: Make Apollo company intelligence MCP-first, privacy-safe, news-cross-checked, and visible in Settings without pulling emails or phone numbers.
- Done:
  - Removed the Apollo People Enrichment code path from the worker. BidStack no longer calls `/people/match` for account intelligence.
  - Kept Apollo MCP company search/get-company as the preferred path, with REST organization enrichment as a fallback when configured.
  - Added public news cross-checking through a fixed GDELT DOC API endpoint for investments, expansion, hiring, layoffs, funding, revenue, acquisitions, and C-level movement signals.
  - Extended account intelligence mapping to include GDELT-backed news articles while stripping contact-channel fields recursively before persistence.
  - Tightened Apollo connector health: MCP is only healthy when both the MCP URL and bearer token are configured; partial MCP config is degraded.
  - Updated Settings > Integrations > AI & Agents copy and `.env.example` defaults for Apollo MCP, opt-in title-only people search, no credit-tool default, and public-news cross-checking.
  - Updated the Apollo privacy-first solution note and issue register.
- Verified:
  - `pnpm --filter @bidstack/worker exec vitest run src/queues/company-enrich-apollo.test.ts --reporter=dot` PASS, 22/22.
  - `pnpm --filter @bidstack/api exec vitest run src/providers/open-data-connectors.test.ts --reporter=dot` PASS, 6/6.
  - `pnpm --filter @bidstack/worker exec tsc --noEmit` PASS.
  - `pnpm --filter @bidstack/api exec tsc --noEmit` PASS.
  - `pnpm --filter @bidstack/worker test` PASS, 19 files / 211 tests.
  - `pnpm --filter @bidstack/api exec vitest run src/providers/open-data-connectors.test.ts src/routes/crm/connectors.test.ts --reporter=dot` PASS, 9/9.
  - Targeted ESLint passed for Apollo worker/test files, open-data connector files, and Settings integration UI.
  - Root `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` all PASS.
  - Browser smoke passed on `http://localhost:5173/settings?tab=integrations` > AI & Agents: Apollo card shows `https://mcp.apollo.io/mcp`, public-news cross-check copy, email/phone safety copy, no People Enrichment env flag, and no console errors.
- Surfaced:
  - No live Apollo call was made because real Apollo MCP/OAuth/API credentials must stay server-side in local env or Azure secrets.
  - Apollo title-only executive search remains explicit opt-in via `APOLLO_MCP_ENABLE_EXECUTIVE_SEARCH=true` + `APOLLO_API_ENABLE_PEOPLE_SEARCH=true`; default stays off.
  - Existing dirty worktree has broad unrelated changes from prior shifts; do not revert them during Apollo follow-up.

## Latest Update - Codex (2026-06-06 23:35 America/New_York)

- Holder: Codex
- Goal slice: Keep Apollo company intelligence privacy-first while restoring the full root quality gates.
- Done:
  - Confirmed Apollo remains MCP company-first: company search/get-company preferred, REST organization enrichment fallback, people tools opt-in only.
  - Verified Apollo mapping covers technologies, employee count, revenue/funding hints, intent, hiring, news, investment, and expansion signals without persisting email/phone/mobile/contact fields.
  - Repaired local Prisma ledger/physical-schema drift by applying existing idempotent additive migration SQL for competitor intelligence, proposal-scoped review issues, standard crew key, and YJS version.
  - Updated Prisma schema to match the existing migrations: `Crew.standardKey`, competitor FK names/update behavior, DB defaults, `ReviewIssue.proposalId`, and related relations.
  - Fixed worker PDF extraction stability: PDFs now use a child-process sandbox because `pdf-parse@2.x` in `worker_threads` can crash Node on Windows; lighter formats still use worker threads.
  - Switched the worker test wrapper to Vitest forks to avoid nested worker-thread runner instability.
- Verified:
  - `pnpm --filter @bidstack/worker exec vitest run src/queues/company-enrich-apollo.test.ts` PASS, 22/22.
  - `pnpm --filter @bidstack/shared test` PASS, 65/65.
  - `node scripts/run-worker-tests.mjs src/lib/extract-text-sandbox.test.ts --reporter=dot` PASS 3 consecutive runs, 5/5 each.
  - `node scripts/run-worker-tests.mjs` PASS, 19 files / 211 tests.
  - `pnpm --filter @bidstack/worker build` PASS.
  - `pnpm test` PASS across workspace.
  - `pnpm lint` PASS across workspace.
  - `pnpm typecheck` PASS across workspace.
  - `pnpm build` PASS across workspace.
  - `pnpm audit --audit-level high` PASS; 3 moderate advisories remain.
- Surfaced:
  - The user previously requested mobile settings/code removal; `NativePushToken` still exists in the Prisma schema. Do not remove it casually because it requires a planned migration/cleanup, but keep it on the next audit list.
  - Root `.env` targets local `localhost:5433/bidstack`; real/staging/prod databases still need normal migration deployment.

## Latest Shift - Codex (2026-06-06)

- Holder: Codex
- Goal: Apollo company intelligence hardening plus continued CRM backend/frontend/API/MCP stability.
- Current state: Apollo company enrichment is privacy-first and focused-test/browser verified. The Prisma schema/client drift that initially blocked API/worker typechecks is resolved in code and root `pnpm typecheck` is green.
- Apollo company intelligence fixes:
  - Apollo MCP company search/get-company is the preferred enrichment path; REST organization enrichment remains a fallback when configured.
  - The CRM maps company firmographics, technologies, employee count, revenue/funding hints, intent, hiring, news, investment, and expansion signals.
  - Emails, phone numbers, mobile numbers, dial/contact fields, and similar contact details are stripped before metadata persistence.
  - MCP/REST people tools are off by default and require explicit admin opt-in for title-only leadership signals.
  - Apollo credit behavior is treated as plan/tool dependent; BidStack no longer claims company search/enrichment is free.
  - Settings > Integrations > AI & Agents now exposes safe Apollo defaults and company-first copy.
  - Account cockpit Business Snapshot now shows Apollo sync freshness plus News and funding status.
- Apollo verified:
  - `pnpm --filter @bidstack/shared build` PASS.
  - `pnpm --filter @bidstack/worker exec vitest run src/queues/company-enrich-apollo.test.ts` PASS, 22/22.
  - `pnpm --filter @bidstack/shared test` PASS, 65/65.
  - Targeted ESLint passed on all Apollo/shared/API/web files touched in this slice.
  - `pnpm --filter @bidstack/api exec vitest run src/providers/open-data-connectors.test.ts` PASS, 5/5.
  - `pnpm --filter @bidstack/web typecheck` PASS.
  - `pnpm --filter @bidstack/web lint` PASS.
  - In-app browser smoke verified Settings Apollo card and account cockpit Apollo rows with no console errors.
- Schema drift fixed:
  - Reconciled `packages/db/prisma/schema.prisma` with existing new migrations and feature code, without editing old migrations.
  - Added Prisma `CompetitorProfile` / `CompetitorInsight` models, competitor insight enums, Org/Opportunity relations, `ReviewIssue.proposalId`, and `YjsDocument.version`.
  - Regenerated Prisma and rebuilt `@bidstack/db`.
- Latest verified:
  - `pnpm --filter @bidstack/db exec prisma validate --schema prisma/schema.prisma` with placeholder `DATABASE_URL` PASS.
  - `pnpm --filter @bidstack/db build` PASS.
  - `pnpm --filter @bidstack/api typecheck` PASS.
  - `pnpm --filter @bidstack/worker typecheck` PASS.
  - `pnpm --filter @bidstack/api exec eslint . --quiet` PASS.
  - `pnpm --filter @bidstack/worker exec eslint . --quiet` PASS.
  - `pnpm --filter @bidstack/worker exec vitest run src/queues/company-enrich-apollo.test.ts src/lib/safe-research-fetch.test.ts` PASS, 25/25.
  - `pnpm --filter @bidstack/shared exec vitest run src/competitor-intel/competitor-intel.test.ts src/utils/ssrf.test.ts` PASS, 27/27.
  - `pnpm --filter @bidstack/api exec vitest run src/providers/open-data-connectors.test.ts src/routes/opportunities.brief.test.ts` PASS, 7/7.
  - `pnpm typecheck` PASS across workspace.
- Runtime/deploy note:
  - Any real DB still needs the existing new migrations deployed before routes that use competitor insights, proposal-scoped review issues, or YJS version compare-and-swap are exercised against that database.
- Key fixes:
  - API client now handles non-JSON proxy/backend failures with endpoint-scoped messages.
  - Dashboard, integrations, and pipeline pages no longer blank whole sections on supporting request failures.
  - Pipeline stage mutation invalidates the right caches and keeps optimistic placement until server data catches up.
  - MCP opportunity stage enums match canonical CRM stages.
  - API-key permission enforcement now requires read/write scopes for REST permission gates.
  - Soft-delete middleware now expands Prisma compound unique selectors before rewriting `findUnique` to `findFirst`.
  - Root `pnpm test` now rebuilds `@bidstack/db` before consumer tests.
  - Pipeline cards are no longer draggable route links; they use explicit draggable controls with click/Enter navigation and stable stage/card test hooks.
  - Pipeline E2E now proves keyboard stage movement updates the target column and persists through the API, then restores the original stage.
  - Web page tests that render money-formatting hooks now stub exchange-rate fetches, removing happy-dom AbortError teardown noise.
  - MCP rate limits now fail closed by default in production and fail open only for dev/test or an explicit override; the custom hourly limiter and Fastify per-minute limiter share the same policy.
  - MCP `proposal.draft` is no longer a stub. It now returns a deterministic source-grounded section draft with CRM evidence, citations, and opted-out contact redaction.
  - API `POST /opportunities/:id/brief` is no longer a stub. It returns a deterministic `crm-grounded-v1` executive brief from opportunity context, tasks, contacts, notes, risk focus, and opt-out redaction.
- Verified:
  - `pnpm test`, `pnpm lint`, `pnpm typecheck`, `pnpm build`, and `pnpm audit --audit-level high` pass.
  - Browser smoke passed for dashboard, pipeline, accounts, opportunities, settings, integrations, webhooks redirect, intake, and RFP pipeline.
  - Pipeline API transition moved and restored a real opportunity successfully.
  - `pnpm --filter @bidstack/web typecheck` and `pnpm --filter @bidstack/web lint` pass after the pipeline card fix.
  - Focused Playwright `e2e/flows/pipeline.spec.ts` passes (5 pass / 1 expected skip) and `e2e/pipeline.spec.ts` passes (4 pass).
  - In-app browser live check on `/pipeline`: 7 columns, 103 cards, no console errors.
  - `pnpm --filter @bidstack/web test` passes cleanly (252/252, no AbortError output).
  - `pnpm --filter @bidstack/mcp-server test`, `typecheck`, and `lint` pass after MCP fail-closed hardening.
  - `pnpm --filter @bidstack/mcp-server test`, `typecheck`, and `lint` pass after grounded proposal draft (35/35 tests).
  - `pnpm --filter @bidstack/api exec vitest run src/routes/opportunities.brief.test.ts src/routes/opportunities.integration.test.ts` passes (14/14).
  - `pnpm --filter @bidstack/api typecheck` and `pnpm --filter @bidstack/api lint` pass after grounded opportunity brief.
- Next focus:
  - Add direct HTML5 drag gesture coverage after the keyboard-accessible move path is stable.
  - Improve semantic headings/accessibility on sparse app shells.
  - Continue backend/API hardening: route-level rate-limit policy and remaining stub/shell routes that still need real workflows.

## Holder

- Holder: Claude (Opus 4.8)
- Claimed at: 2026-06-04 America/New_York (from Codex)
- Goal: Close Codex's open RFP-pipeline issues to enterprise quality — RFP-GATE-001 (Critical approval gating), RFP-REVIEW-001 (first-class ReviewIssue persistence), RFP-CREW-002 (schema-backed standard crew identity), RFP-CREW-001 (crew-seed DB integration tests).

## Current State

- **RFP-GATE-001 (Critical) — RESOLVED.** Proposal approval now gates + advances the linked orchestration in one transaction (final-gate check, atomic approve, conditional state move, in-tx blocker re-check). `apps/api/src/routes/rfp-pipeline.ts`.
- **RFP-REVIEW-001 (High) — RESOLVED.** Review crew returns a structured finding contract and persists first-class `ReviewIssue` rows (scoped by new `proposalId` column); GATE-001 reads them. `apps/worker/src/queues/rfp-legal-scan.ts`.
- **Adversarial review run** (`bidstack-rfp-competitor-review` workflow, 5 lenses) — 7 confirmed findings (3 blocker / 4 major), **all fixed** (cite-or-omit URL bug, SSRF redirect, IPv6/CGNAT denylist, review-crew clobber, gate TOCTOU, migration FK drift). See ISSUE_REGISTER REVIEW-FINDINGS-001..005.
- **NEW FEATURE — Competitor Intelligence (grounded, cited)** slice 1/3 landed: `@bidstack/shared/competitor-intel` (cite-or-omit, USASpending pricing, SSRF fetch), schema + migration, `docs/competitor-intel.md`.
- Codex's NIM/Dust provider hardening + relay baton remain in place (unchanged this shift).

## Touched Files This Shift (Claude)

- `apps/api/src/routes/rfp-pipeline.ts`, `rfp-pipeline.helpers.ts`, `rfp-pipeline.test-helpers.ts`, `rfp-pipeline.approve.integration.test.ts`
- `apps/worker/src/queues/rfp-legal-scan.ts`, `__tests__/rfp-review-crew.test.ts`
- `packages/shared/src/competitor-intel/{index.ts,competitor-intel.test.ts}`, `utils/{ssrf.ts,ssrf.test.ts,webhook-url.ts,index.ts}`, `index.ts`
- `apps/api/src/lib/ssrf-guard.ts` (re-export shared SSRF)
- `packages/db/prisma/schema.prisma` (+ migrations `20260604000000_competitor_intel`, `20260604000100_review_issue_proposal_scope`)
- `docs/competitor-intel.md`, `docs/solutions/grounded-citations-and-approval-gate-coupling.md`

## Last Verified

- `pnpm --filter @bidstack/api typecheck` — PASS (after `prisma generate`).
- `pnpm --filter @bidstack/worker typecheck` — PASS.
- Shared tests (`vitest run`): 63 pass incl. competitor-intel (20) + ssrf (6).
- Worker `rfp-review-crew.test.ts` (direct vitest): 9 pass.
- ESLint on all touched files — clean.
- `prisma validate` — valid; `prisma generate` — succeeded (no DLL lock this session).
- NOT run here (no DB / no live LLM): the `skipIfNoDb` integration tests + live smoke. See Hand-off.

## Blockers And Risks

- **DB migrations NOT applied** (I have no `DATABASE_URL`). Tony must `prisma migrate deploy` the two new migrations on the real DB, then the regenerated client matches. Without this, runtime queries referencing `review_issues.proposal_id` / competitor tables fail.
- Competitor research **web fetch needs an IP-pinning `fetchImpl`** before slice 2 ships (DNS-rebinding residual — documented).
- Competitor web search needs one search-API key (Tavily/Exa/SerpAPI); USASpending needs none.
- RFP-CREW-002 (name-only crew identity) + RFP-CREW-001 (crew-seed DB tests) still OPEN — not started this shift.
- Codex's NVIDIA key note still stands (rotate; local secrets only).

## Resolved This Shift (Claude)

- RFP-GATE-001 (Critical), RFP-REVIEW-001 (High) — resolved + reviewed + fixed.
- RFP-CREW-002, RFP-CREW-001 — resolved (migration `20260604000200_crew_standard_key`; seed by key; integration tests).
- Competitor Intel slices 1 + 2 — grounded core, schema, worker queue + processor (IP-pinning fetch), API routes. Registered in worker `main.ts` + `server.routes.ts`.
- 4 new migrations to apply: `20260604000000_competitor_intel`, `20260604000100_review_issue_proposal_scope`, `20260604000200_crew_standard_key` (+ the schema regen).

## Next Actions

All baton issues (GATE-001, REVIEW-001, CREW-001, CREW-002) and the full Competitor
Intelligence feature (slices 1-3) are landed and verified. Remaining is operational:

1. **Tony (required before runtime):** `pnpm db:migrate` (deploy the **5** new migrations: `20260604000000_competitor_intel`, `_000100_review_issue_proposal_scope`, `_000200_crew_standard_key`, `_000300_activity_idempotency_org_scope`, `_000400_contact_email_index`) + `pnpm db:generate`; add the 4 competitor env vars to `.env.example` (see `docs/competitor-intel.md`); then run the `skipIfNoDb` integration tests + a live approval + competitor-research smoke.

**Two full review rounds this shift** (50 agents total): REVIEW-2 (13 findings, all fixed) + REVIEW-3 (21 findings: 18 fixed, 3 deferred-and-specified). 7 blockers fixed in all — incl. 3 broken public routes, the opportunity-code minter dead-lock, an SSRF loopback gap, a signed-PDF data-loss bug, and an MCP auth-expiry bypass. See ISSUE_REGISTER REVIEW-2 + REVIEW-3.
2. **Deferred (next focused pass)** — 3 confirmed majors needing larger/untestable-here changes: Graph email + calendar delta pagination (follow nextLink/pageToken), and YJS compaction compare-and-swap. Exact fixes in REVIEW-3.
2. (Optional) Wire a search key (`COMPETITOR_SEARCH_PROVIDER=tavily` + `COMPETITOR_SEARCH_API_KEY`) to add web findings beyond USASpending pricing.
3. (Optional hardening) Upgrade `safe-research-fetch` to a connection-pinning undici dispatcher if `undici` is added as a worker dep (closes the residual DNS-rebinding window).

## Codex Update - 2026-06-07 Org-Scoped Agent Provider Credentials

- Added encrypted per-org direct model provider credential management for
  Claude, OpenAI, Kimi, NVIDIA NIM, and Gemma/local in Settings ->
  Integrations -> AI & Agents.
- Agent Studio provider readiness and execution now prefer org credentials, then
  fall back to platform env/Azure-style runtime config. Secrets are masked and
  never returned to the browser.
- Added admin-only credential writes and read-permission credential listing at
  `/api/v1/integrations/agent-providers/credentials`.
- Live smoke found a production-relevant bug: the local `integration_configs`
  table lacks the named `integration_configs_org_type_name_key` constraint that
  old code used for `ON CONFLICT ON CONSTRAINT`. Provider credential and Dust
  credential writes now use transaction-scoped advisory locks plus
  update-or-insert writes instead.
- Verified with focused API tests, API/web lint, API/web typecheck, web build,
  a reversible Gemma credential API smoke, and in-app browser smokes for
  Settings AI & Agents plus `/agent-studio`.
- Next schema-quality pass: add a proper additive migration for provider config
  typing and a unique active `(org_id,type,name)` invariant instead of the
  compatibility `type='dust'` provider credential storage.

## Codex Update - 2026-06-07 Agent Run Controls And Crew History

- Agent execution now prevents duplicate active runs per org/agent with a
  transaction-scoped advisory lock and returns a `409` conflict instead of
  silently creating competing runs.
- Added single-agent run cancel/retry API routes, UI controls, and audit rows.
  Cancelled runs are not overwritten by late provider completions.
- Agent Studio crew runs now expose stored inputs through crew-run read routes,
  and the UI includes a Run History panel with View plus Run again/Retry actions
  using the original bounded RFP input.
- Sidebar footer/status now sticks to the viewport bottom, so long CRM pages keep
  the identity/status area available while scrolling.
- Verified focused API integration tests, API/web lint, API/web typecheck, web
  build, and live browser smoke on `/agent-studio`.
- Next focused pass: add queue-aware active crew cancellation/retry endpoints,
  then wire Intake OCR output directly into crew run inputs with source evidence
  selection rather than requiring pasted text.
