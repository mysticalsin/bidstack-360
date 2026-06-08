# Codex Status

Done:      Added org-scoped provider credentials, hardened agent and crew run controls, made Agent Studio crew history operational, propagated cooperative provider cancellation, and added the first real bid-workspace evidence handoff. Agent Studio can now search live opportunities, load persisted documents/requirements from the RFP workspace, fill a cited crew input with document/requirement/source-chunk IDs, and run from that evidence.

Now:       Agent Studio evidence handoff is verified in focused tests, lint, typecheck, production web build, and browser smoke. The sticky shell still holds on the long Agent Studio page.

Next:      Close the full RFP loop: upload/import any document from Intake or the RFP pipeline, run OCR/Omniparse extraction, create source chunks/requirements, select evidence, run the specialist crew, persist cited outputs, and enforce approval gates. Continue Twenty parity through platform primitives: configurable objects/views/workflows/agents, API/webhooks, permissions, and provider-flexible AI.

Surfaced:  Full Twenty parity is not complete. The verified Agent Studio foundation covers provider-neutral agents, readiness, recovery controls, sticky shell behavior, cooperative provider cancellation, and bid-workspace evidence selection. Audit-log inserts were slow locally during retry verification, so audit write latency should remain on the observability/performance backlog.

Last verified:

- `pnpm --filter @bidstack/web exec vitest run src/pages/agentStudio/evidence.test.ts --reporter=dot` - PASS, 2/2.
- `pnpm --filter @bidstack/web exec eslint src/pages/AgentStudioPage.tsx src/pages/agentStudio/evidence.ts src/pages/agentStudio/evidence.test.ts --quiet` - PASS.
- `pnpm --filter @bidstack/web typecheck` - PASS.
- `pnpm --filter @bidstack/web build` - PASS.
- In-app browser smoke on `/agent-studio`: evidence panel opens from `Run`, opportunity search returns live records, selected RFP workspace evidence fills the crew input with preserved line breaks, `Run crew` becomes enabled, and no app console errors appear.

- `pnpm --filter @bidstack/worker exec vitest run src/crew/engine.test.ts src/crew/dust-executor.test.ts src/lib/rfp-llm.test.ts src/lib/llm-provider.test.ts --reporter=dot` - PASS, 49/49.
- `pnpm --filter @bidstack/dust-client exec vitest run src/client.test.ts --reporter=dot` - PASS, 3/3.
- Focused worker and Dust client eslint - PASS.
- `pnpm --filter @bidstack/dust-client build` - PASS.
- `pnpm --filter @bidstack/dust-client typecheck` - PASS.
- `pnpm --filter @bidstack/worker typecheck` - PASS.
- `pnpm --filter @bidstack/web build` - PASS.
- Local `GET http://localhost:5173/api/agents/provider-status` - PASS, returned six provider readiness rows without secret values.
- In-app browser smoke on `/agent-studio` - PASS: provider readiness renders `2/6 ready`, no visible load/request error after reload, and sticky sidebar/topbar remain pinned after bottom scroll.

- `pnpm --filter @bidstack/api exec vitest run src/services/agents/agents.helpers.test.ts --reporter=dot` - PASS, 5/5.
- `pnpm --filter @bidstack/api exec eslint src/lib/agent-provider-credentials.ts src/routes/agent-provider-credentials.routes.ts src/routes/dust-credentials.routes.ts src/services/agents/agents.helpers.ts src/services/agents/agents.helpers.test.ts src/services/agents/agents.service.ts src/routes/agents.ts src/server.routes.ts --quiet` - PASS.
- `pnpm --filter @bidstack/web exec eslint src/pages/integrations/AgentProviderCredentialsCard.tsx src/hooks/useAgentProviderCredentials.ts src/components/agents/AgentProviderStatusCard.tsx src/components/settings/IntegrationsSection.tsx --quiet` - PASS.
- `pnpm --filter @bidstack/api typecheck` - PASS.
- `pnpm --filter @bidstack/web typecheck` - PASS.
- `pnpm --filter @bidstack/web build` - PASS.
- Live reversible API smoke saved and soft-deleted a Gemma/local org credential; provider status reported Gemma as `source: "org"` while active.
- In-app browser smoke on Settings -> Integrations -> AI & Agents - PASS.
- In-app browser smoke on `/agent-studio`, including sticky sidebar scroll check - PASS.
- `pnpm --filter @bidstack/api exec vitest run src/routes/agents.integration.test.ts --reporter=dot` - PASS, 4/4.
- `pnpm --filter @bidstack/api exec eslint src/services/agents/agents.service.ts src/routes/agents.ts src/routes/agents.integration.test.ts src/routes/crews.ts --quiet` - PASS.
- `pnpm --filter @bidstack/web exec eslint src/pages/AgentStudioPage.tsx src/hooks/useAgents.ts src/pages/agents/AgentsSquadTable.tsx --quiet` - PASS.
- `pnpm --filter @bidstack/api typecheck` - PASS.
- `pnpm --filter @bidstack/web typecheck` - PASS.
- `pnpm --filter @bidstack/web build` - PASS after Agent Studio history and sticky sidebar footer.
- In-app browser smoke on `/agent-studio`: crew runner, Intake handoff, Run Crew, and Run History render without visible request/load errors.
- `pnpm --filter @bidstack/api exec vitest run src/routes/crews.integration.test.ts src/routes/agents.integration.test.ts --reporter=dot` - PASS, 8/8.
- `pnpm --filter @bidstack/api exec eslint src/routes/crews.ts src/routes/crews.integration.test.ts src/queues/crew-run.ts src/plugins/mutation-audit.ts --quiet` - PASS.
- `pnpm --filter @bidstack/api exec eslint ../worker/src/queues/crew-run.ts --quiet` - PASS.
- `pnpm --filter @bidstack/web exec eslint src/pages/AgentStudioPage.tsx --quiet` - PASS.
- `pnpm --filter @bidstack/worker typecheck` - PASS.
- In-app browser smoke on `/agent-studio`: no visible load error, sticky shell anchored, crew runner opens, and Intake/Run Crew/Run History states render.
