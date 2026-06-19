# SERUM Versioned Config Control Plane

## Problem

SERUM settings are high-trust operator controls. A premium UI is not enough:
drafts, publishes, rollbacks, audits, and secret handling must be real before
the product can claim an agent control plane.

## Pattern

- Store config as org-scoped immutable versions keyed by `configType`,
  `configKey`, `environment`, and `version`.
- Keep statuses explicit: `draft`, `active`, `archived`, and `rolled_back`.
- Use shared schemas for API responses and frontend hooks so the UI cannot drift
  from the persistence contract.
- Guard writes with `settings:write` plus admin role; reads use
  `settings:read`.
- Run draft/publish/rollback in a transaction and take an advisory lock for the
  org/type/key/environment tuple before allocating a version number.
- Never store raw provider secrets in config JSON. Reject secret-looking keys
  unless the field is a secret reference or boolean secret status.
- Write audit-log rows for every draft, publish, and rollback action.
- Return the relevant audit trail in config snapshots, scoped to the version ids
  included in the snapshot, so settings UI history is backed by the same audit
  table as the mutation path.
- Return `Cache-Control: no-store` for live config snapshots.
- In React, let the editor component own unsaved text state and remount it by
  backend version id. This avoids render-effect resets while preserving current
  user edits.
- Build the settings UI as a section-driven workbench: the 24 SERUM sections
  share the same snapshot/write/audit contract, while each section supplies its
  own config type, key, status mapping, default config, and related surface.
- Add a backend-owned candidate test route before trusting publish controls:
  `POST /api/v1/serum/configs/:configType/:configKey/test` accepts
  `{ environment, configJson }`, returns pass/warn/fail checks, sets
  `Cache-Control: no-store`, and does not persist a config version.
- Treat Test as a deterministic preflight, not a simulation. It can prove raw
  secret rejection, approval gates, caps, allowlists, citations, eval
  thresholds, and dry-run requirements. It cannot prove the external provider,
  connector, or agent actually executed unless the route calls that subsystem.
- Add typed controls for high-risk sections, but keep the JSON object as the
  canonical editor state. Switches, selects, number fields, and allowlist inputs
  should update the same JSON submitted to Test, Save draft, Publish, and
  Rollback.
- Scope dense readiness panels with accessible regions. High-risk settings
  often repeat labels like "Human approval" in switches, summaries, and test
  results; browser assertions and assistive tech need a stable panel boundary.
- Persist approval state on high-risk config versions. New drafts for Agents,
  Loops, Model Router, Tools, Connectors, Prompt Library, Evals, and Dust/MCP
  Gateway start as `approvalStatus=required`.
- Add request/approve routes before publish. Both routes must be admin-only,
  write audit-log entries, and re-run deterministic config tests before they
  change approval state.
- Make publish fail closed for high-risk drafts unless the draft has
  `approvalStatus=approved`, an approver, an approved timestamp, an approval
  reference, and a fresh passing deterministic config test.
- Enforce separation of duties for high-risk approvals: once a requester submits
  a draft for approval, that requester is immutable, cannot approve the same
  draft, and publish must reject stored evidence where requester and approver
  are the same user.
- Acquire the config advisory lock and re-read the draft under lock before
  validating request, approve, or publish state. A pre-lock validation can race
  and let stale state overwrite approval evidence.
- Surface the approval state in the settings workbench with a dedicated
  Approval gate tile and explicit Request approval / Approve actions. Publish
  should stay disabled client-side while the backend remains the authority.
- Return a requester-relative flag such as `approvalRequestedByCurrentUser` so
  the UI can disable self-approval and explain that a different admin must
  approve the draft.
- Published high-risk configs must feed a backend runtime authority, not only a
  settings UI. Add a no-store policy snapshot route plus narrow runtime checks
  that future workers can call immediately before execution.
- Runtime policy checks should fail closed when no active policy exists. A
  missing active config is `not_configured`, not an implicit allow.
- Start runtime enforcement with the highest blast-radius surfaces: Agents,
  Tools, and Model Router. Read `agents/registry`, `tools/registry`, and
  `model_router/routing` as the default runtime config keys.
- Put runtime policy helpers in a package that every executor can import. API
  route checks are not sufficient if workers, MCP servers, or future routers
  can still start work without the same authority.
- Check Agents policy before crew-run start/retry is queued, then check it
  again inside the worker after claiming the run and before any provider call.
  Exclude the current run id from active concurrency counts during worker
  revalidation so the run does not deny itself.
- Preserve old client contracts when adding approval signals. Optional retry
  payloads should default to `{ approvalConfirmed: false }` inside the handler;
  malformed payloads still return 400, but no-body retries remain valid.
- Agent Studio must gate crew execution on both RFP input and explicit operator
  approval, and the backend must receive the same `approvalConfirmed` evidence.
- Tool names are runtime input, so the tool-scope map needs a string index
  signature. Unknown tools should default to write scope and be denied unless
  explicitly allowlisted.
- MCP tool execution must call the Tools runtime check immediately before the
  handler is invoked. Treat missing active policy, disabled policy, unlisted
  tools, and dry-run violations as fail-closed denials.
- Model routing checks must validate the requested provider against the active
  default/fallback providers, usable runtime credentials, source citation
  requirements, token caps, and uncertainty mode.
- Put the Model Router runtime check at the shared direct-provider execution
  wrapper, not only at API check endpoints. In the worker this is
  `runRfpCompletion`, which covers RFP extraction, drafting, QA, compliance,
  competitor research, contract extraction, and crew/legal direct LLM calls.
- Map wire provider kinds back to policy provider ids before checking policy:
  `anthropic -> claude`, `moonshot -> kimi`, `nim -> nvidia_nim`; `openai` and
  `gemma` already match.
- If the Model Router denies a direct route or the policy read fails, do not call
  the direct provider and do not fall through to Dust. Record an AI audit error
  and return deterministic fallback. Dust-only execution needs the separate
  Dust/MCP Gateway runtime policy.

## Gate

After changing shared config schemas:

```powershell
pnpm --filter @bidstack/shared build
pnpm --filter @bidstack/db generate
pnpm --filter @bidstack/api typecheck
pnpm --filter @bidstack/web typecheck
```

Focused persistence regression:

```powershell
$env:DATABASE_URL='postgresql://bidstack:bidstack@localhost:5433/bidstack'
pnpm --filter @bidstack/api test -- src/routes/serum.integration.test.ts
```

The API regression should include one unsafe high-risk config that fails
multiple checks and one safe disabled config that passes without writing a
`SerumConfigVersion` row.

It should also publish approved high-risk Agents, Tools, and Model Router
configs, then call the runtime check endpoints and prove both denied and allowed
decisions before execution.

Crew/MCP execution regression:

```powershell
$env:DATABASE_URL='postgresql://bidstack:bidstack@localhost:5433/bidstack'
pnpm --filter @bidstack/api test -- src/routes/crews.integration.test.ts
pnpm --filter @bidstack/mcp-server test -- src/serum-policy.test.ts
pnpm --filter @bidstack/web test -- src/pages/AgentStudioPage.test.tsx
pnpm --filter @bidstack/worker test -- src/lib/rfp-llm.test.ts src/crew/dust-executor.test.ts
```

The crew regression should prove a denied agent blocks queueing, missing
operator approval blocks queueing, approved starts queue, and retry without a
request body still works. The MCP regression should prove allow and deny
decisions are enforced before handler execution. The Agent Studio regression
should prove Run crew remains disabled until both RFP text and explicit agent
approval are present.

The worker model-router regression should prove direct providers check SERUM
before execution, brand-provider mapping is correct, denied routes make no model
or Dust call, router-check errors make no model or Dust call, and configured
direct-provider failures no longer silently fall through to Dust.

Dust/MCP Gateway runtime regression:

```powershell
pnpm --filter @bidstack/shared test -- src/schemas/serum.test.ts
pnpm --filter @bidstack/api test -- src/routes/serum.integration.test.ts
pnpm --filter @bidstack/worker test -- src/lib/dust-credentials.test.ts src/crew/dust-executor.test.ts src/lib/rfp-llm.test.ts
```

The gateway regression should prove a missing gateway policy returns
`not_configured`, enabled Dust without an audit trail is denied, external writes
are denied unless the write mode and approval signal explicitly allow them, and
read/agent-run Dust operations are allowed only when the active gateway policy
allows Dust with secret references and tool-audit evidence.

Factory rule:

- API and worker Dust execution must go through `getOrgDust` / `buildDustClient`
  so `listDocuments`, `getDocument`, `listAgents`, `runAgent`,
  `getConversation`, and `upsertDocument` all check the runtime gateway policy.
- Direct `new DustClient(...)` is allowed only for admin credential validation
  before credentials are saved/published; it must not execute agent runs,
  document sync, assistant actions, or status polling.
- Write operations such as `dust.upsertDocument` are external side effects. They
  should fail closed without an explicit approval signal until a product-level
  approval workflow exists.

Focused browser regression:

```powershell
$env:E2E_PORT_OFFSET='760'
$env:E2E_WORKERS='1'
pnpm --filter @bidstack/web exec playwright test e2e/serum-account-experience.spec.ts --project=chromium-desktop --grep "SERUM status and industry panels" --reporter=list
```

The browser gate should click at least one non-default SERUM section and prove
its own `/api/v1/serum/configs/:type/:key` snapshot returns live JSON. This
keeps the 24-section workbench from silently regressing back to a single
General-only editor.

It should also click that section's Test button and prove the matching
`/api/v1/serum/configs/:type/:key/test` POST returns and renders a checklist.

For the Agents section, the browser gate should additionally exercise the typed
operator controls by toggling `Enabled`, setting `Max concurrent runs`, adding
an `Allowed agents` list, and verifying the canonical JSON textarea reflects
those values before pressing Test.

For high-risk sections, the API regression should prove:

- publish before approval returns 409;
- request approval records requester, timestamp, and approval reference;
- a second request cannot replace the original requester;
- the original requester cannot approve the draft;
- approve records approver and timestamp;
- publish succeeds only after approval and preserves the approval evidence;
- publish rejects manually inconsistent approval evidence where requester and
  approver are the same user;
- unsafe configs cannot enter the requested state.

The browser gate should prove the selected high-risk section exposes the
Approval gate tile plus Request approval and Approve actions, and that the
SERUM unavailable banner remains absent.

## Watchouts

- `prisma migrate dev` can hang on a busy local Windows workspace. If it does,
  use `prisma migrate diff` only to generate SQL, inspect for unrelated drift,
  then apply a surgical migration with `prisma migrate deploy`.
- Prisma JSON columns require `Prisma.InputJsonObject` for writes; a Zod
  `Record<string, unknown>` is not directly assignable.
- Do not put high-risk config changes behind optimistic UI only. The backend
  version id and audit row are the source of truth.
- Do not let E2E assertions depend only on old heading copy when the settings
  information architecture changes. Assert behavior, endpoint responses, and
  stable labels for the selected section.
- Do not use broad `getByText` assertions for repeated readiness labels. Scope
  to the checklist panel or use exact text, otherwise Playwright strict mode can
  fail because the same phrase appears in the summary and result row.
- Do not let typed controls drift into a second source of truth. If a control
  changes a high-risk field, the JSON textarea must update immediately and the
  backend test route must receive that edited JSON.
- Do not rely on a narrowed boolean from a type guard after assigning it to a
  separate variable. Parse the persisted `configType` into the shared enum and
  carry that typed value into deterministic test calls.
- Do not treat a visible disabled Publish button as sufficient governance. The
  backend publish route must own the approval check, because API callers can
  bypass client controls.
- Do not validate approval state from a row read before the advisory lock.
  Request, approve, and publish must lock, re-read, and validate the locked
  version or concurrent requests can swap approval evidence.
- Do not let requester-relative UI state become the control. It improves UX, but
  the API must still reject self-approval and same-requester publish evidence.
- Do not stop at publishing high-risk policy. Every execution surface needs a
  final runtime check immediately before work starts; otherwise the control
  plane can drift from what agents, tools, or routers actually do.
- Do not let the API route be the only enforcement point for queued work. A
  worker must re-check policy after claim and before external provider calls
  because jobs can outlive policy changes.
- Do not break existing retry clients when adding approval fields. Validate
  optional bodies in the handler if Fastify/Zod would otherwise reject no-body
  requests before legacy clients reach app code.
- Do not type a runtime registry map as a closed literal if it is indexed by
  request input. Use `Record<string, Scope>` and make unknown entries fail
  closed.
- Do not treat local keyless Gemma the same as remote providers. Gemma can be
  considered runtime-configured without an API key; remote providers need a
  usable stored credential.
- Do not preserve fail-open model fallback once a direct provider route is
  selected. A direct route denied by SERUM, or an allowed direct route that
  fails at runtime, must not escape into Dust unless the Dust/MCP Gateway policy
  explicitly allows that path.
- Do not patch Dust runtime checks one caller at a time. Guard the Dust client
  factory and keep a grep gate for direct `new DustClient(...)` construction;
  otherwise API assistants, worker jobs, status probes, and sync pushes drift
  apart.

## Retrieval Runtime Policy

When a SERUM section controls retrieval, the execution guard must sit directly
before the embedding/search provider call, not only at config publish time.

The current Retrieval runtime policy lives in
`packages/db/src/serum-runtime-policy.ts` and is exposed through the shared
runtime snapshot schema. It validates:

- an active published Retrieval policy exists;
- the section is enabled;
- source grounding is present when required;
- requested chunks do not exceed the configured maximum;
- expected confidence meets the configured floor;
- `noSourceBehavior` is not an unsafe answer-anyway mode.

The API endpoint
`POST /api/v1/serum/runtime-policy/retrieval/:configKey/check` is the external
policy contract. Runtime callers inside the monorepo should prefer the shared
helper directly when they already run in a backend package.

Current enforcement points:

- `apps/mcp-server/src/lib/reference-search.ts` checks Retrieval policy before
  Cohere embedding. Denied or errored checks fall back to keyword search and do
  not call Cohere.
- `apps/worker/src/queues/rfp-embed-requirement.ts` checks Retrieval policy
  before requirement embeddings.
- `apps/worker/src/queues/rfp-embed-reference.ts` checks Retrieval policy
  before reference embeddings.

Regression requirements for any new retrieval execution path:

- missing published policy denies before the provider call;
- disabled policy denies before the provider call;
- ungrounded source input denies when grounding is required;
- over-limit chunk requests deny before the provider call;
- allowed policy reaches the provider path exactly once;
- provider denial path must not silently fall through to another unguarded
  semantic provider.

Do not count a Retrieval UI/config change as complete unless at least one
execution-call-site test proves the provider call is skipped when SERUM denies.

## Prompt Library Runtime Policy

When SERUM governs prompt execution, publish-time config tests are not enough.
The runtime guard must run immediately before a prompt reaches a model provider
or Dust agent.

The current Prompt Library runtime policy lives in
`packages/db/src/serum-runtime-policy.ts` and validates:

- an active published Prompt Library policy exists;
- `allowedPromptSets` is non-empty;
- the requested prompt set is explicitly allowed;
- versioned prompts are present when required;
- prompt-injection test coverage is present when required;
- production prompt execution has approved release evidence when the active
  environment is `production`.

The API endpoint
`POST /api/v1/serum/runtime-policy/prompt-library/:configKey/check` is the
external policy contract. Backend code should prefer
`checkSerumPromptLibraryRuntimePolicy` directly when it already runs inside the
monorepo.

Current enforcement points:

- `apps/worker/src/lib/rfp-llm.ts` checks Prompt Library policy before direct
  LLM or Dust calls through the shared RFP completion wrapper. Denied or errored
  checks return `null`, so callers use deterministic fallbacks and no provider
  call is made.
- `apps/worker/src/queues/rfp-requirement-extract.processor.ts` wraps the legacy
  extraction provider block with the Prompt Library check before direct LLM or
  Dust execution.
- `apps/api/src/services/ai/dust-agent.service.ts` checks Prompt Library policy
  before legacy bid-score defense and proposal-section Dust helpers build and
  run prompts.

Regression requirements for any new prompt execution path:

- missing published Prompt Library policy denies before the provider call;
- empty or missing allowed prompt-set list denies;
- disallowed prompt set denies;
- missing injection-test evidence denies when required;
- allowed prompt set reaches the provider path exactly once;
- denied direct-provider execution must not fall through to Dust or another
  unguarded provider.

Do not count a Prompt Library UI/config change as complete unless at least one
execution-call-site test proves the model/Dust call is skipped when SERUM
denies.

## Evals Quality Gate Runtime Policy

SERUM evals are release evidence, so draft validation is not enough. The runner
or release workflow must ask the runtime policy authority whether the named
suite and the observed result can count toward publish/ship evidence.

The current Evals Quality Gate runtime policy lives in
`packages/db/src/serum-runtime-policy.ts` and validates:

- an active published Evals Quality Gate policy exists;
- release evals are required before publish;
- `regressionSuites` is non-empty;
- the requested eval suite is explicitly allowed;
- `blockOnFailure` is enabled;
- the suite has zero failing fixtures when block-on-failure is enabled;
- pass rate meets the configured `minimumPassRate`.

The API endpoint
`POST /api/v1/serum/runtime-policy/evals-quality-gates/:configKey/check` is the
external policy contract. Backend code should prefer
`checkSerumEvalsQualityGateRuntimePolicy` directly when it already runs inside
the monorepo.

Current enforcement point:

- `apps/api/src/evals/run-evals.ts` preflights the policy before required eval
  runs and enforces the final pass rate/failure count after fixture execution.
  `EVAL_MODE=full` always requires SERUM eval policy, preventing expensive
  model-backed release evals from running without org-scoped policy evidence.

Regression requirements for any new eval execution path:

- missing published Evals Quality Gate policy denies release evidence;
- disabled `requiredBeforePublish` denies release evidence;
- disallowed suite denies release evidence;
- any fixture failure denies when `blockOnFailure` is true;
- pass rate below threshold denies;
- full/model-backed evals must require org-scoped policy context before the
  model-backed judge runs.

Do not count an eval UI/config change as complete unless at least one execution
or runner test proves SERUM denial blocks the release gate.

## Connector Runtime Policy

SERUM connector controls must protect network egress, not only settings JSON.
Any route, worker, or plugin that calls an external SaaS/ERP/CRM/calendar
connector needs a runtime decision immediately before the external call.

The current Connector runtime policy lives in
`packages/db/src/serum-runtime-policy.ts` and validates:

- an active published Connector policy exists;
- connectors are enabled;
- secret references are present;
- connection-test evidence is present when required;
- connector mode is one of the safe modes;
- read-only/manual modes block writes;
- draft-write mode blocks external writes at runtime;
- approved-write mode requires explicit approval confirmation for writes.

Connection-test evidence should be a formal ledger entry, not a loose inference,
when a connector has a real health probe. Runtime connector checks should pass
`connectionTestProbe: false`; only the dedicated test/probe path should record
new connection-test evidence. This keeps normal egress from minting its own
proof.

The API endpoint
`POST /api/v1/serum/runtime-policy/connectors/:configKey/check` is the external
policy contract. Backend code should prefer `checkSerumConnectorRuntimePolicy`
directly when it already runs inside the monorepo.

Current enforcement points:

- `apps/api/src/lib/serum-connector-policy.ts` and
  `apps/worker/src/lib/serum-connector-policy.ts` are the local helper
  boundaries. New connector execution should use these helpers instead of
  reimplementing fail-closed policy handling.
- `apps/api/src/routes/erp-integration.ts` checks Connector policy before
  ERP/Odoo MCP egress. Status and presales-kit surfaces fail soft; direct proxy
  endpoints fail with 403 before the sidecar is called.
- `apps/worker/src/queues/calendar-sync-microsoft.ts` checks Connector policy
  before Microsoft Graph calendar push/update/delete and incremental pull.
- `apps/api/src/services/slack.service.ts` checks Connector policy before Slack
  channel posts, replies, and DMs.
- `apps/api/src/services/twilio-sms.service.ts` checks Connector policy before
  Twilio credential lookup and SMS send egress.
- `apps/api/src/services/email-integration.service.ts` checks Connector policy
  before Gmail/Microsoft email send and pull execution.
- `apps/api/src/services/microsoft-graph.service.ts` checks Connector policy
  before the older Microsoft Graph mail send and incremental pull paths.
- `apps/api/src/routes/migrations-hubspot.routes.ts` and
  `apps/worker/src/queues/migration.ts` check Connector policy before HubSpot
  import start and HubSpot page fetch egress.
- `apps/worker/src/queues/calendar-sync-google.ts` checks Connector policy
  before Google Workspace calendar push/update/delete, incremental pull, and
  watch-channel renewal.
- `apps/api/src/routes/webhook-subscriptions.ts` and
  `apps/worker/src/queues/webhook-delivery.ts` check Connector policy before
  webhook test pings and partner delivery egress. Denied deliveries are recorded
  as failed attempts without calling the partner URL.

Regression requirements for any new connector execution path:

- missing published Connector policy denies before network egress;
- disabled Connector policy denies before network egress;
- missing secret references deny;
- missing connection-test evidence denies when required;
- write attempts deny in read-only/manual/draft-write modes;
- approved-write mode denies writes without explicit approval confirmation;
- tests must assert the external fetch/client call is not reached when SERUM
  denies.

Do not count a Connector UI/config change as complete unless at least one
execution-call-site test proves the external connector call is skipped when
SERUM denies.

Coverage notes:

- `packages/integrations` plugin scaffolding had no current app imports during
  the 2026-06-17 connector-family audit. Treat it as non-runtime until wired,
  and require a SERUM helper call before exposing those tools to app execution.
- Older connectors do not all have a formal connection-test evidence table yet.
  Until that exists, avoid claiming SOC-style connector completeness beyond the
  current runtime denial guarantees.
- After adding a DB/runtime-policy package migration, rebuild `@bidstack/db`
  before running API/worker integration tests. Otherwise tests can import stale
  compiled policy code and appear to deny valid connection-test evidence.

## Loop Runtime Policy

SERUM Loop controls are an execution boundary. They must decide whether a loop
may start, retry, replay, or cross an approval boundary immediately before the
loop is queued or resumed.

The current Loop runtime policy lives in
`packages/db/src/serum-runtime-policy.ts` and validates:

- an active published Loop policy exists;
- loops are enabled;
- durable-event evidence exists when required;
- approval boundaries stop execution unless explicitly handled;
- replay is disabled unless the published policy allows it;
- approval-required replay has explicit approval confirmation;
- retry count stays within the published cap;
- automatic or continuous replay modes are denied until a stronger autonomous
  safety contract exists.

The API endpoint
`POST /api/v1/serum/runtime-policy/loops/:configKey/check` is the external
policy contract. Backend code should prefer `checkSerumLoopRuntimePolicy`
directly when it already runs inside the monorepo.

Current enforcement points:

- `apps/api/src/queues/rfp-orchestrator.ts` checks Loop policy before enqueueing
  RFP orchestration work.
- `apps/worker/src/queues/rfp-orchestrator.ts` checks Loop policy again before
  orchestration upsert and child fan-out.
- `apps/api/src/routes/crews.ts` checks Loop policy before Crew run and retry
  queueing.
- `apps/worker/src/queues/crew-run.ts` checks Loop policy before provider-backed
  Crew execution starts.

Regression requirements for any new loop execution path:

- missing published Loop policy denies before queue or execution;
- disabled Loop policy denies;
- missing durable-event evidence denies when required;
- approval-boundary crossing denies unless the code path has an explicit human
  confirmation contract;
- retry count above policy denies;
- replay denies unless allowed by policy and approved when required;
- tests must assert queue/external execution is not reached when SERUM denies.

Do not count a Loop UI/config change as complete unless at least one producer or
worker execution test proves SERUM denial blocks the loop before side effects.

## Status Snapshot Audit Freshness

The SERUM status endpoint is an operator-facing trust surface. If a user drafts,
publishes, approves, or rolls back SERUM config, the status summary and Mission
Control audit drawer must reflect that fresh control-plane activity without a
logout or manual cache reset.

`apps/api/src/routes/serum.ts` now includes `serum_config.%` audit events in the
`latestConfigChangeAt` status summary query, alongside agent-provider, Dust,
org settings, and RBAC events.

Regression requirement:

- after a SERUM draft/publish/rollback flow writes `serum_config.*` audit rows,
  `GET /api/v1/serum/status` must return
  `summary.latestConfigChangeAt` at or after that flow;
- the status endpoint must still return `Cache-Control: no-store`;
- missing optional backend signal rows should degrade into `signalHealth`, not
  force the UI into the generic unavailable state.

Verification:

- `pnpm --filter @bidstack/api exec vitest run src/routes/serum.integration.test.ts -t "persists versioned config drafts" --reporter=dot`:
  failed before the SQL fix with `latestConfigChangeAt: null`, then passed.
- `pnpm --filter @bidstack/api exec vitest run src/routes/serum.integration.test.ts --reporter=dot`:
  7/7 pass.
- `pnpm --filter @bidstack/api exec eslint src/routes/serum.ts src/routes/serum.integration.test.ts --max-warnings=0`:
  pass.
- `pnpm --filter @bidstack/api exec tsc --noEmit --pretty false`: pass.
