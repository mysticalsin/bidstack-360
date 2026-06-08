# Agent Studio Provider-Neutral Crew UX

## Problem

Agent Studio is the place where bid teams build and run the RFP specialist crew.
If it feels like a generic agent list, users do not understand the production
workflow: upload documents, extract/OCR, review cited evidence, run specialists,
then approve. If the provider model is hard-coded, the CRM becomes vendor-locked
and cannot support GPT, Claude, Kimi, NVIDIA NIM, Gemma/local models, or Dust
cleanly.

## Pattern

1. Treat Agent Studio as the control tower for the RFP response workflow, not as
   a raw CRUD page.
2. Put the document path before the prompt box: file-based RFPs go through
   Intake/OCR first; direct text input is for already-extracted evidence.
3. Keep model credentials server-side. UI records the provider/model choice and
   may manage org-owned encrypted credentials, but it never stores or displays
   plaintext API secrets.
4. Support OpenAI-compatible providers through one typed adapter, with
   org-scoped credentials first, provider-specific env variables as fallback,
   and explicit error messages when credentials are missing.
5. Pair provider choice with provider readiness: show configured/missing status,
   setup source, model, endpoint, and missing server-side env keys without
   returning secret values.
6. Preserve Dust as a first-class agent path, but do not require Dust for every
   phase agent.
7. Add browser/e2e coverage for navigation chrome that affects usability on
   long operational pages.
8. Make runs recoverable: every agent/crew execution surface needs visible
   history, cancel/retry affordances where backend state supports it, and stored
   bounded inputs so users can rerun work without reconstructing context.

## Current Implementation

- Agent Studio control tower and run guidance:
  `apps/web/src/pages/AgentStudioPage.tsx`
- RFP agent provider picker:
  `apps/web/src/components/agents/AgentDialog.tsx`,
  `apps/web/src/pages/agents/AgentsStarterGrid.tsx`,
  `apps/web/src/pages/agents/AgentsSquadTable.tsx`
- Provider schemas:
  `packages/shared/src/schemas/rfp-agent.schemas.ts`
- OpenAI-compatible provider adapter:
  `apps/api/src/services/agents/agents.helpers.ts`
- Provider readiness endpoint:
  `apps/api/src/routes/agents.ts`,
  `apps/api/src/services/agents/agents.helpers.ts`
- Org-scoped provider credential storage:
  `apps/api/src/lib/agent-provider-credentials.ts`,
  `apps/api/src/routes/agent-provider-credentials.routes.ts`
- Settings provider credential UI:
  `apps/web/src/pages/integrations/AgentProviderCredentialsCard.tsx`,
  `apps/web/src/hooks/useAgentProviderCredentials.ts`
- Provider readiness UI:
  `apps/web/src/components/agents/AgentProviderStatusCard.tsx`,
  `apps/web/src/hooks/useAgents.ts`,
  `apps/web/src/components/settings/IntegrationsSection.tsx`
- Provider dispatcher:
  `apps/api/src/services/agents/agents.service.ts`
- Agent run controls and regression tests:
  `apps/api/src/routes/agents.ts`,
  `apps/api/src/routes/agents.integration.test.ts`,
  `apps/web/src/pages/agents/AgentsSquadTable.tsx`
- Crew run history:
  `apps/api/src/routes/crews.ts`,
  `apps/web/src/pages/AgentStudioPage.tsx`
- Sticky sidebar regression:
  `apps/web/src/components/layout/Sidebar.tsx`,
  `apps/web/src/index.css`,
  `apps/web/e2e/navigation.spec.ts`

## Twenty Takeaways

Twenty's open-source CRM treats objects, views, workflows, agents, API/webhooks,
permissions, and app extensions as first-class product primitives. BidStack
should keep borrowing that shape without copying code: agents should be
permissioned, discoverable, provider-flexible, and wired to real CRM/RFP data
contracts instead of empty shells. The BidStack advantage should be deeper RFP
workflow: OCR/extraction, cited evidence, specialist reviews, approval gates,
and proposal-ready outputs.

References:

- https://github.com/twentyhq/twenty
- https://docs.twenty.com/user-guide/getting-started/capabilities/what-is-twenty
- https://github.com/twentyhq/twenty/releases

## Verification

- `pnpm --filter @bidstack/web exec eslint src/pages/AgentStudioPage.tsx src/components/layout/Sidebar.tsx src/components/agents/AgentDialog.tsx src/pages/AgentsPage.tsx src/pages/agents/AgentsStarterGrid.tsx src/pages/agents/AgentsSquadTable.tsx e2e/navigation.spec.ts --quiet`
- `pnpm --filter @bidstack/web typecheck`
- `pnpm --filter @bidstack/web build`
- `pnpm --filter @bidstack/api exec vitest run src/services/agents/agents.helpers.test.ts --reporter=dot`
- `pnpm --filter @bidstack/shared exec vitest run src/schemas/rfp-agent.test.ts --reporter=dot`
- `pnpm --filter @bidstack/api typecheck`
- `pnpm --filter @bidstack/api exec vitest run src/routes/agents.integration.test.ts --reporter=dot`
- `pnpm --filter @bidstack/api exec eslint src/services/agents/agents.service.ts src/routes/agents.ts src/routes/agents.integration.test.ts src/routes/crews.ts --quiet`
- `pnpm --filter @bidstack/web exec eslint src/pages/AgentStudioPage.tsx src/hooks/useAgents.ts src/pages/agents/AgentsSquadTable.tsx --quiet`
- `pnpm --filter @bidstack/web exec playwright test e2e/navigation.spec.ts --grep "desktop sidebar toggle remains anchored while scrolling long pages"`
- Direct local route check on `/api/v1/agents/provider-status`
- In-app browser smoke on `/agent-studio`
- In-app browser smoke on Settings -> Integrations -> AI & Agents
- Reversible live API smoke for an org-scoped Gemma/local credential
- In-app browser smoke on `/agent-studio` crew runner: Intake handoff, Run Crew,
  and Run History render without visible request/load errors.
