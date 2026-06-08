# Lessons

Append durable lessons here. Promote repeated mistakes to `MISTAKES.md`; promote reusable engineering patterns to `docs/solutions/`.

## 2026-06-07: Agent Crews Need Evidence IDs, Not Just Text

- Context: Agent Studio could run a crew over pasted text, while the CRM already
  had bid-workspace documents, requirements, and source chunks from the RFP
  extraction path.
- Lesson: RFP agent inputs should carry source IDs alongside readable text.
  Include opportunity IDs, document IDs, requirement IDs, chunk IDs, priority,
  confidence, and explicit citation instructions so the crew can reason from
  persisted evidence and the CRM can trace output back to source material.
- Codified in: `apps/web/src/pages/agentStudio/evidence.ts`,
  `apps/web/src/pages/AgentStudioPage.tsx`,
  `docs/solutions/agent-studio-bid-workspace-evidence-handoff.md`

## 2026-06-07: Credential Writes Must Not Depend On Undeployed Constraint Names

- Context: Agent provider and Dust credential writes attempted
  `ON CONFLICT ON CONSTRAINT integration_configs_org_type_name_key`, but the
  live local DB did not have that constraint, causing 500s when saving provider
  config.
- Lesson: Before using named-constraint upserts, verify the live database
  actually has that constraint or add an additive migration. For compatibility
  paths, use a transaction-scoped advisory lock plus update-or-insert and write
  audit evidence in the same transaction.
- Codified in: `apps/api/src/routes/agent-provider-credentials.routes.ts`,
  `apps/api/src/routes/dust-credentials.routes.ts`

## 2026-06-07: Agent Provider Readiness Must Use Tenant-Owned Credentials

- Context: Agent Studio could show provider readiness from platform env only,
  but enterprise admins need org-owned model keys for Claude, OpenAI, Kimi,
  NVIDIA NIM, and local Gemma without exposing secrets in the browser.
- Lesson: Provider readiness and execution should resolve org credentials first,
  mask secrets on every read path, audit credential mutations, and keep platform
  env/Azure-style config as a fallback rather than the only setup path.
- Codified in: `apps/api/src/lib/agent-provider-credentials.ts`,
  `apps/api/src/services/agents/agents.helpers.ts`,
  `apps/web/src/pages/integrations/AgentProviderCredentialsCard.tsx`

## 2026-06-07: Provider Selection Needs Readiness, Not Guesswork

- Context: Agent Studio supported multiple provider families, but users still
  could not tell which providers were configured and which server-side setup
  keys were missing.
- Lesson: Provider-neutral UX must pair choice with safe readiness evidence.
  Expose missing setup contracts and source labels, never secret values. Keep
  direct-provider credentials server-side until an encrypted per-org credential
  path is implemented.
- Codified in: `packages/shared/src/schemas/rfp-agent.schemas.ts`,
  `apps/api/src/services/agents/agents.helpers.ts`,
  `apps/web/src/components/agents/AgentProviderStatusCard.tsx`,
  `docs/solutions/agent-studio-provider-neutral-crew-ux.md`

## 2026-06-07: Agent Studio Must Explain The RFP Production Line

- Context: `/agent-studio` had real crew infrastructure, but the screen did not
  clearly teach users how documents become OCR/extracted evidence, specialist
  review, and approval-ready outputs.
- Lesson: The workflow surface must show the RFP path before the controls.
  File-based work goes through Intake/OCR first; direct model prompts are only
  for already-extracted text. Provider choice belongs in typed config while
  credentials stay server-side.
- Codified in: `apps/web/src/pages/AgentStudioPage.tsx`,
  `apps/api/src/services/agents/agents.helpers.ts`,
  `docs/solutions/agent-studio-provider-neutral-crew-ux.md`

## 2026-06-07: Agent Runs Need Operator Recovery, Not Just Fire-And-Forget

- Context: Agent execution could start duplicate active runs, and the UI had no cancel/retry controls for failed or stuck work.
- Lesson: Any LLM/agent workflow that can spend money or block an RFP response needs explicit active-run locks, cancel/retry state transitions, audit rows, and UI recovery controls.
- Codified in: `apps/api/src/services/agents/agents.service.ts`, `apps/api/src/routes/agents.ts`, `apps/web/src/pages/agents/AgentsSquadTable.tsx`, `docs/solutions/agent-run-controls-and-crew-history.md`

## 2026-06-07: Crew Workers Need State Guards Around Every Write

- Context: Crew runs are asynchronous BullMQ jobs. Without guarded state transitions, a cancelled run can be overwritten by a late worker completion or failure.
- Lesson: Worker jobs should claim work with an atomic `queued -> running` update and write terminal results only while the row is still in the expected active state. API cancellation can then be data-safe even before provider adapters support physical abort.
- Codified in: `apps/api/src/routes/crews.ts`, `apps/api/src/queues/crew-run.ts`, `apps/worker/src/queues/crew-run.ts`, `docs/solutions/agent-run-controls-and-crew-history.md`

## 2026-06-07: Cancellation Must Propagate Through Provider Clients

- Context: Crew run cancel/retry protected CRM state, but active Dust/direct
  model calls could still run until completion because cancellation stopped at
  the database boundary.
- Lesson: For queue-backed AI workflows, cancellation must travel as an
  `AbortSignal` from the worker state watcher through the workflow engine,
  executor, provider wrapper, and HTTP client. User aborts should not be logged
  as provider failures.
- Codified in: `apps/worker/src/crew/engine.ts`,
  `apps/worker/src/crew/dust-executor.ts`, `apps/worker/src/lib/rfp-llm.ts`,
  `apps/worker/src/lib/llm-provider.ts`, `packages/dust-client/src/index.ts`,
  `docs/solutions/agent-run-controls-and-crew-history.md`

## 2026-06-07: Advisory Lock Calls With No Rowset Belong To `$executeRaw`

- Context: PostgreSQL `pg_advisory_xact_lock(...)` returns `void`; using Prisma `$queryRaw` caused a serialization failure in the duplicate-run regression test.
- Lesson: Use `$executeRaw` for side-effect raw SQL calls that do not need returned rows. Reserve `$queryRaw` for rowset-producing SQL.
- Codified in: `apps/api/src/services/agents/agents.service.ts`, `MISTAKES.md`

## 2026-06-07: Crew History Needs Inputs, Not Just Outputs

- Context: Agent Studio could show a crew result but could not reliably reopen or rerun it because crew-run read routes omitted the original inputs.
- Lesson: For RFP workflows, run history must include bounded original inputs and evidence identifiers; otherwise retry UX becomes guesswork.
- Codified in: `apps/api/src/routes/crews.ts`, `apps/web/src/pages/AgentStudioPage.tsx`

## 2026-06-07: Sticky Navigation Includes The Bottom Status Area

- Context: The topbar and sidebar toggle stayed pinned, but the sidebar footer/status disappeared below long navigation content.
- Lesson: Treat sidebar footers that carry user/status/identity signals as persistent shell controls. Use sticky bottom placement instead of a normal document footer on enterprise app shells.
- Codified in: `apps/web/src/index.css`

## 2026-06-07: Read Contracts Must Tolerate Historical Identifiers

- Context: The opportunities API rejected persisted codes outside `OP-NNNN` during response serialization, turning valid historical data into a list-view `500`.
- Lesson: Do not reuse create/import validation blindly on read models. Reads should accept bounded persisted values; writes should enforce the current canonical contract.
- Codified in: `packages/shared/src/schemas/opportunity.ts`, `packages/shared/src/schemas/opportunity.test.ts`, `docs/solutions/opportunity-code-read-write-contract.md`

## 2026-06-07: Fail-Fast Redis Clients Still Need a Recovery Path

- Context: The API Redis client was configured to fail fast, but after a transient disconnect it could stay in an ended state and keep `/readyz` at `503` even after Redis was reachable again.
- Lesson: Do not confuse "do not queue commands indefinitely" with "never reconnect." Health and cache clients need a bounded reconnect attempt before reporting readiness failure or falling back to memory.
- Codified in: `apps/api/src/redis.ts`, `apps/api/src/lib/redis-cache.ts`, `apps/api/src/routes/health.ts`, `docs/solutions/redis-readiness-reconnect.md`

## 2026-06-07: Cockpit Pages Must Survive Background Refresh Failures

- Context: The account cockpit could show a fatal "Couldn't load" state after an idle/background dashboard refresh failed, even though a valid account snapshot was already on screen.
- Lesson: Account and dashboard pages should distinguish initial-load failure from background-refresh failure. If verified data exists, keep it visible and show an inline refresh warning instead of blanking the workflow.
- Codified in: `apps/web/src/pages/DashboardPage.tsx`, `apps/web/src/pages/DashboardPage.test.tsx`, `docs/solutions/account-cockpit-stale-refresh-resilience.md`

## 2026-06-07: Vendor Freshness Must Be Recomputed, Not Trusted Forever

- Context: Apollo strategic-intel payloads persisted a `freshness` flag, but weekly refresh policy depends on the timestamp, not the old label.
- Lesson: Persist vendor timestamps, then recompute freshness at the read boundary. Stored labels can describe the original write, but they cannot be the durable source of truth for cache validity.
- Codified in: `apps/api/src/services/crm/company-enrichment.service.ts`, `apps/api/src/services/crm/company-enrichment.service.test.ts`, `docs/solutions/apollo-company-intelligence-privacy-first.md`

## 2026-06-07: i18n Component Tests Need Runtime Bootstrap

- Context: `CurrencySelector.test.tsx` rendered without app i18n setup, causing interpolation placeholders to appear during the full web test gate.
- Lesson: Tests that assert translated/interpolated UI should either import the app i18n bootstrap or explicitly mock the translation layer with equivalent interpolation behavior.
- Codified in: `apps/web/src/components/layout/CurrencySelector.test.tsx`

## 2026-06-06: Dist-Aware Package Gates

- Context: API tests import `@bidstack/db` through `packages/db/dist`, so source-only DB middleware fixes were invisible until the DB package was rebuilt.
- Lesson: Root gates must build every dist-backed workspace package before running consumer tests. `pnpm test` now rebuilds `@bidstack/db`.
- Codified in: `package.json`, `docs/solutions/rebuild-package-dist-before-consumer-tests.md`

## 2026-06-06: Prisma Action Rewrites Need Argument Normalization

- Context: Soft-delete middleware rewrote `findUnique` to `findFirst`, but compound unique selectors are valid only in `findUnique` shape.
- Lesson: Middleware that rewrites Prisma operations must normalize both the action and the args. Compound selectors must expand into field filters before adding `deletedAt: null`.
- Codified in: `packages/db/src/middleware/soft-delete.ts`, `docs/solutions/soft-delete-compound-unique-selectors.md`

## 2026-06-06: Pipeline Moves Need UI Plus API Regression Coverage

- Context: A split pipeline card component regressed to a draggable route link even though the repo had already documented that anchors are bad drag sources.
- Lesson: For revenue-critical board moves, tests must prove the record appears in the target column and the API persists the new stage. "Drag did not throw" is not a business-valid test.
- Codified in: `apps/web/e2e/flows/pipeline.spec.ts`, `docs/solutions/drag-drop-not-on-anchor.md`

## 2026-06-06: Money-formatting Page Tests Must Own Rates

- Context: Page tests mocked CRM data hooks but still rendered `useFormatMoney`, which starts exchange-rate fetching on mount.
- Lesson: If a test renders `useFormatMoney` or `useDisplayMoney`, stub `/api/v1/exchange-rates` or preload valid cached rates. Otherwise passing tests can still print happy-dom teardown AbortErrors.
- Codified in: `apps/web/src/pages/TerritoriesPage.test.tsx`, `apps/web/src/pages/OpportunitiesPage.test.tsx`, `docs/solutions/test-owned-exchange-rate-fetches.md`

## 2026-06-07: Apollo Account Intelligence Must Stay Company-First

- Context: Apollo can expose both company intelligence and people/contact tooling, but Tony's account-cockpit use case explicitly forbids pulling emails or phone numbers.
- Lesson: Use Apollo MCP company tools first, keep REST organization enrichment as fallback, remove People Enrichment from account intelligence, and allow only explicit opt-in title-only executive search. Cross-check strategic signals with public news before presenting them as account context.
- Codified in: `apps/worker/src/queues/company-enrich-apollo.ts`, `apps/api/src/providers/open-data-connectors.ts`, `apps/web/src/components/settings/IntegrationsSection.tsx`, `docs/solutions/apollo-company-intelligence-privacy-first.md`

## 2026-06-07: Every Company Creation Path Must Reach Async Verification

- Context: Manual enrich queued Apollo verification, but sales/opportunity autopopulate only wrote the local company cache.
- Lesson: Account-intelligence lifecycle invariants must be enforced at the service layer, not only on one route. Newly enriched companies should enqueue async Apollo verification; fresh cached companies should not requeue.
- Codified in: `apps/api/src/services/crm/company.service.ts`, `apps/api/src/services/crm/company.service.test.ts`, `apps/api/src/routes/crm/companies.ts`

## 2026-06-06: Production MCP Limits Must Fail Closed

- Context: MCP automation keys can read and mutate CRM data, so Redis outages cannot silently remove shared budget enforcement in production.
- Lesson: Local/test rate limiters may fail open for developer velocity, but production MCP rate-limit failure mode must be a single explicit policy shared by every limiter.
- Codified in: `apps/mcp-server/src/plugins/hourly-rate-limit.ts`, `apps/mcp-server/src/server.ts`, `docs/solutions/mcp-rate-limit-fail-closed-production.md`

## 2026-06-06: MCP Tools Must Return Useful Deterministic Output Before AI

- Context: `proposal.draft` was callable by agents but returned setup instructions instead of proposal content.
- Lesson: If live AI is unavailable or out of scope, the tool should still produce a bounded, source-grounded deterministic result with citations and follow-up checks. Do not expose empty shells to agent workflows.
- Codified in: `apps/mcp-server/src/tools/proposal-draft.ts`, `docs/solutions/mcp-proposal-drafts-must-be-grounded.md`

## 2026-06-06: Brief Routes Need Route Tests, Not Only Builder Tests

- Context: The opportunity brief builder was correct, but the first route wiring queried `Note.customer` instead of legacy `Note.accountId`.
- Lesson: For generated CRM summaries, pair pure builder tests with at least one route test that exercises Prisma model fields. Model-specific account fields are not interchangeable.
- Codified in: `apps/api/src/routes/opportunities.brief.ts`, `apps/api/src/routes/opportunities.integration.test.ts`, `docs/solutions/opportunity-briefs-must-be-grounded.md`

## 2026-06-04: Live AI Provider Calls Need Multi-Tier Fallback

- Context: NVIDIA NIM can fail transiently or return pending/empty output while org Dust credentials are still valid.
- Lesson: RFP AI paths should treat direct provider, Dust, and deterministic fallback as distinct tiers. A failed earlier tier should not skip a configured later tier.
- Codified in: `apps/worker/src/lib/rfp-llm.ts`, `apps/worker/src/queues/rfp-requirement-extract.processor.ts`

## 2026-06-04: Confidentiality Gates Must Precede Parsing, Not Just LLM Calls

- Context: OmniParse/OCR/conversion can be external processing, so checking NDA-D only before model calls is too late.
- Lesson: For RFP documents, confidentiality gates must run before any extraction/conversion service that could leave the worker.
- Codified in: `apps/worker/src/queues/rfp-requirement-extract.processor.ts`

## 2026-06-04: Cross-Model Work Needs A Baton, Not Chat Memory

- Context: Claude, Gemini, and Codex need a shared source of truth for progress, issues, blockers, lessons, and next commands.
- Lesson: Use `handoff/relay-baton/` as the tracked shift handoff. Update it before ending work and read it before starting.
- Codified in: `handoff/relay-baton/README.md`

## 2026-06-04: Make "no hallucination" a code invariant, not a prompt

- Context: a feature must surface competitor pricing that is never invented.
- Lesson: enforce grounding in three independent layers — fetch the sources yourself, drop any model finding whose URL is not in the fetched set (`enforceCitations`), and make the DB column `NOT NULL` so an uncited row cannot persist. Never rely on "please only use real sources."
- Pitfall the review caught: URL canonicalisation for the citation check must lowercase ONLY scheme+host — path/query are case-sensitive (RFC 3986), else an invented case-variant collides with a fetched URL.
- Codified in: `packages/shared/src/competitor-intel/index.ts`, `docs/solutions/grounded-citations-and-approval-gate-coupling.md`

## 2026-06-04: A human approval gate must move the workflow state, atomically

- Context: proposal approval stamped the artifact but left the orchestration stuck, dead-ending the pipeline.
- Lesson: the gate owns the state transition. Do it in one transaction with row-count-asserted conditional updates, and re-check blockers INSIDE the transaction (a pre-tx check alone is TOCTOU). Scope blockers to the run (`proposalId`), not the opportunity, or a sibling re-run silently clears them.
- Codified in: `apps/api/src/routes/rfp-pipeline.ts`

## 2026-06-04: SSRF guards must survive redirects, DNS rebinding, and IPv6

- Context: a string-hostname allow-check plus `redirect:'follow'` is not SSRF-safe.
- Lesson: follow redirects manually and re-validate every hop; cover IPv6 ULA/link-local + IPv4-mapped + CGNAT in the denylist; and for real protection pin+validate the resolved IP at connect time (the string check can't see DNS rebinding). Always add a redirect-to-internal regression test — an initial-host-only test gives false assurance.
- Codified in: `packages/shared/src/competitor-intel/index.ts`, `packages/shared/src/utils/webhook-url.ts`
