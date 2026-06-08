# Agent Provider Credentials: Org Secret Routing

## Problem

Enterprise tenants need their own model-provider credentials for Claude, OpenAI,
Kimi, NVIDIA NIM, and local Gemma-style runtimes. Platform env credentials are
useful for demos and managed deployments, but they are not enough for a CRM that
must avoid vendor lock-in and support tenant-owned procurement, audit, and key
rotation.

The first live credential smoke also exposed a schema drift risk: raw SQL used a
named `integration_configs` unique constraint that was not present in the live
local database, causing credential saves to return `500`.

## Pattern

1. Resolve credentials in this order: org-owned encrypted credential, then
   platform env/Azure-style runtime config, then local deterministic fallback
   only where the provider supports it.
2. Never return plaintext secrets to the browser. Read APIs may return
   configured state, source, model, endpoint, masked tail, and updated time.
3. Credential mutations are admin-only and write audit evidence in the same
   transaction as the credential change.
4. Validate endpoints by environment:
   - Production direct-provider endpoints must be public HTTPS.
   - Local Gemma endpoints may use localhost only outside production.
5. Do not use `ON CONFLICT ON CONSTRAINT` unless the live database has that
   constraint or a migration adds it. Compatibility writes should use a
   transaction-scoped advisory lock plus update-or-insert.

## Current Implementation

- Credential resolver:
  `apps/api/src/lib/agent-provider-credentials.ts`
- Credential routes:
  `apps/api/src/routes/agent-provider-credentials.routes.ts`
- Agent execution and readiness:
  `apps/api/src/services/agents/agents.helpers.ts`,
  `apps/api/src/services/agents/agents.service.ts`
- Settings UI:
  `apps/web/src/pages/integrations/AgentProviderCredentialsCard.tsx`,
  `apps/web/src/hooks/useAgentProviderCredentials.ts`
- Dust credential compatibility fix:
  `apps/api/src/routes/dust-credentials.routes.ts`

## Verification

- `pnpm --filter @bidstack/api exec vitest run src/services/agents/agents.helpers.test.ts --reporter=dot`
- `pnpm --filter @bidstack/api exec eslint src/lib/agent-provider-credentials.ts src/routes/agent-provider-credentials.routes.ts src/routes/dust-credentials.routes.ts src/services/agents/agents.helpers.ts src/services/agents/agents.helpers.test.ts src/services/agents/agents.service.ts src/routes/agents.ts src/server.routes.ts --quiet`
- `pnpm --filter @bidstack/web exec eslint src/pages/integrations/AgentProviderCredentialsCard.tsx src/hooks/useAgentProviderCredentials.ts src/components/agents/AgentProviderStatusCard.tsx src/components/settings/IntegrationsSection.tsx --quiet`
- `pnpm --filter @bidstack/api typecheck`
- `pnpm --filter @bidstack/web typecheck`
- `pnpm --filter @bidstack/web build`
- Reversible live API smoke for a Gemma/local org credential
- In-app browser smoke on Settings -> Integrations -> AI & Agents
- In-app browser smoke on `/agent-studio`

## Follow-Up

Add a proper additive migration for a generic AI provider config type and a
unique active `(org_id,type,name)` invariant. The current `type='dust'` storage
is a compatibility bridge, not the ideal long-term data model.
