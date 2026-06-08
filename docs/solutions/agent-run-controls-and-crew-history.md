# Agent Run Controls And Crew History

## Problem

Agent/RFP workflows are not normal CRUD. A failed run can block a bid, duplicate
runs can spend money and produce conflicting outputs, and a user needs to recover
without rebuilding the prompt from memory.

## Pattern

1. Lock active run creation per org/agent before writing a new run.
2. Return a clear `409` when an agent already has a queued/running run.
3. Use terminal-state validation for cancel/retry routes.
4. Never let a late provider completion overwrite a user-cancelled run.
5. Audit cancel/retry with enough linkage to reconstruct old run -> new run.
6. Expose bounded original inputs on run-history read routes so the UI can
   reopen or rerun work.
7. For queue-backed crews, remove queued jobs when possible, but treat the
   database state as authoritative.
8. Worker jobs must claim work atomically and guard every terminal write by the
   expected active status.
9. Pass `AbortSignal` from the worker state watcher through the workflow engine,
   executor, provider wrapper, and HTTP clients so running cancellations release
   local worker resources and stop waiting on provider responses.
10. Do not log user-initiated cancellation as provider failure telemetry.

## Implementation

- `apps/api/src/services/agents/agents.service.ts`
  - `runAgent` uses a transaction-scoped advisory lock and active-run check.
  - `cancelAgentRun` only cancels queued/running runs and clears agent status
    when no active sibling remains.
  - `retryAgentRun` only retries failed/cancelled runs, starts a real new run,
    then audits the old/new run relationship.
- `apps/api/src/routes/agents.ts`
  - Adds cancel/retry routes with permission gates and conflict responses.
- `apps/api/src/routes/agents.integration.test.ts`
  - Covers duplicate active run rejection, cancel success, terminal cancel
    rejection, and retry with original input.
- `apps/api/src/routes/crews.ts`
  - Crew-run read routes return stored bounded `inputs`.
  - Adds owner-or-admin cancel/retry routes for crew runs.
  - Cancel supports queued/running runs; retry supports failed/cancelled/partial
    runs and creates a new queued run from stored inputs.
- `apps/api/src/queues/crew-run.ts`
  - Adds best-effort removal of queued BullMQ jobs by deterministic job id.
- `apps/worker/src/queues/crew-run.ts`
  - Claims only queued runs, skips runs that changed state, and only writes
    completion/failure while the run is still running.
  - Watches active run state and aborts the cooperative provider signal when
    the row leaves `running`.
- `apps/worker/src/crew/engine.ts`
  - Accepts kickoff cancellation options, checks abort before and after task
    execution, and passes the signal to every executor invocation.
- `apps/worker/src/crew/dust-executor.ts`
  - Passes crew cancellation into the shared RFP provider wrapper.
- `apps/worker/src/lib/rfp-llm.ts`
  - Passes cancellation to direct providers and Dust, and rethrows user aborts
    before warning/audit failure logging.
- `apps/worker/src/lib/llm-provider.ts`
  - Merges per-call timeouts with external cancellation and uses the merged
    signal for provider `fetch` calls.
- `packages/dust-client/src/index.ts`
  - Accepts cancellation for Dust agent runs and aborts retry backoff waits.
- `apps/web/src/hooks/useAgents.ts`
  - Adds cancel/retry mutations and cache invalidation.
- `apps/web/src/pages/agents/AgentsSquadTable.tsx`
  - Adds cancel/retry controls to run history.
- `apps/web/src/pages/AgentStudioPage.tsx`
  - Adds crew Run History with View, Cancel, Retry, and Run again actions.

## Verification

- `pnpm --filter @bidstack/api exec vitest run src/routes/agents.integration.test.ts --reporter=dot`
- `pnpm --filter @bidstack/api exec vitest run src/routes/crews.integration.test.ts src/routes/agents.integration.test.ts --reporter=dot`
- `pnpm --filter @bidstack/api exec eslint src/services/agents/agents.service.ts src/routes/agents.ts src/routes/agents.integration.test.ts src/routes/crews.ts --quiet`
- `pnpm --filter @bidstack/api exec eslint src/routes/crews.ts src/routes/crews.integration.test.ts src/queues/crew-run.ts src/plugins/mutation-audit.ts --quiet`
- `pnpm --filter @bidstack/api exec eslint ../worker/src/queues/crew-run.ts --quiet`
- `pnpm --filter @bidstack/web exec eslint src/pages/AgentStudioPage.tsx src/hooks/useAgents.ts src/pages/agents/AgentsSquadTable.tsx --quiet`
- `pnpm --filter @bidstack/api typecheck`
- `pnpm --filter @bidstack/worker typecheck`
- `pnpm --filter @bidstack/web typecheck`
- `pnpm --filter @bidstack/web build`
- `pnpm --filter @bidstack/worker exec vitest run src/crew/engine.test.ts src/crew/dust-executor.test.ts src/lib/rfp-llm.test.ts src/lib/llm-provider.test.ts --reporter=dot`
- `pnpm --filter @bidstack/dust-client exec vitest run src/client.test.ts --reporter=dot`
- `pnpm --filter @bidstack/dust-client build`
- `pnpm --filter @bidstack/dust-client typecheck`
- In-app browser smoke on `/agent-studio` crew runner.

## Follow-Up

- Link Intake/OCR document IDs and source chunks to crew-run inputs so reruns
  can use evidence bundles, not only pasted extracted text.
