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

## 2026-06-18: Integration Token Key Fail-Closed Format

The runtime token cipher has a stricter production contract: `INTEGRATION_TOKEN_KEY`
must be a 64-character hex string generated with `openssl rand -hex 32`.

Why this matters: a 64-character non-hex string satisfies a length-only check but
does not produce a 32-byte AES-256 key. That failure can otherwise surface only
when a tenant saves or decrypts an OAuth/provider token. For a 100k-user
deployment, malformed secret configuration must fail at boot or at the crypto
boundary, not during a customer integration flow.

Implementation:

- `packages/shared/src/crypto/token-cipher.ts` now rejects non-hex key values.
- `packages/shared/src/crypto/token-cipher.test.ts` covers round-trip,
  nondeterministic IVs, missing keys, non-hex 64-character keys, and malformed
  ciphertext.
- `apps/api/src/env.ts` rejects malformed `INTEGRATION_TOKEN_KEY` in production
  during boot-time env validation.
- `.env.example` and `scripts/ops/rotate-secrets.sh` now use
  `openssl rand -hex 32`, matching `docs/RUNBOOK.md`.

Verification:

- `pnpm --filter @bidstack/shared test -- src/crypto/token-cipher.test.ts --reporter=dot`:
  4/4 pass.
- `pnpm --filter @bidstack/api test -- src/env.test.ts --reporter=dot`: 5/5
  pass.
- `pnpm --filter @bidstack/shared exec tsc --noEmit --pretty false`: pass.
- `pnpm --filter @bidstack/api exec tsc --noEmit --pretty false`: pass.
- Targeted shared/API ESLint: pass.
- `bash -n scripts/ops/rotate-secrets.sh scripts/ops/deploy-checklist.sh scripts/check-secrets.sh`:
  pass.
- Shared and API builds: pass.

## 2026-06-18: Azure Deployment Key Contract

The Azure draft must carry the same key contract as the runtime. The Bicep
parameter now uses `@minLength(64)` and `@maxLength(64)`, and its description
names `openssl rand -hex 32` instead of base64.

`scripts/verify-azure-infra-policy.mjs` guards the deployment surface:

- `integrationTokenKey` exists and is exactly length-gated to 64 characters.
- The parameter description says 64-character hex and names
  `openssl rand -hex 32`.
- The description does not call the key base64.
- Key Vault, Container Apps secret references, and `INTEGRATION_TOKEN_KEY`
  env wiring stay connected to `integration-token-key`.

Verification:

- `node --check scripts/verify-azure-infra-policy.mjs`: pass.
- `pnpm deploy:evidence:azure:policy:selftest`: pass.
- `pnpm deploy:evidence:azure:policy`: pass.
- `pnpm exec eslint --no-ignore --no-warn-ignored scripts/verify-azure-infra-policy.mjs`:
  pass.
- `az bicep version`: not run; Azure CLI is not installed on this machine.

## 2026-06-19: Server-Crypto Key Contract Alignment

The `@bidstack/shared/server-crypto` helper now enforces the same
`INTEGRATION_TOKEN_KEY` contract as the token cipher, API boot validation,
rotation script, and Azure deployment parameter: a 64-character hex AES-256 key
generated with `openssl rand -hex 32`.

Why this matters: Dust credentials, agent/data provider credentials, HubSpot
migration helpers, worker org LLM configuration, and SERUM runtime policy all
import `@bidstack/shared/server-crypto`. Leaving this helper permissive would
let a legacy base64 key reach a production secret boundary even after the newer
token-cipher and env gates were fixed.

Implementation:

- `packages/shared/src/utils/crypto.ts` rejects legacy base64 key material and
  64-character non-hex values.
- `packages/shared/src/utils/crypto.test.ts` covers round-trip encryption,
  nondeterministic ciphertext, missing env, legacy base64 rejection, and wrong
  alphabet rejection.
- The GCM tag length is passed explicitly on encrypt/decrypt so the constant and
  cipher configuration stay synchronized.
- `pnpm --filter @bidstack/shared build` refreshed the local gitignored
  runtime output for `@bidstack/shared/server-crypto`.

Verification:

- `pnpm --filter @bidstack/shared exec vitest run src/utils/crypto.test.ts src/crypto/token-cipher.test.ts --reporter=dot`:
  8/8 pass.
- `pnpm --filter @bidstack/api exec vitest run src/env.test.ts --reporter=dot`:
  7/7 pass.
- `pnpm --filter @bidstack/shared exec eslint src/utils/crypto.ts src/utils/crypto.test.ts src/crypto/token-cipher.ts src/crypto/token-cipher.test.ts --max-warnings=0`:
  pass.
- `pnpm --filter @bidstack/shared exec tsc --noEmit --pretty false`: pass.
- `pnpm --filter @bidstack/shared build`: pass.

## 2026-06-19: Integration Token Rotation Fail-Closed Guard

The quarterly secret rotation script now refuses to rotate
`INTEGRATION_TOKEN_KEY` unless the re-encryption tool contract exists at
`scripts/rotate-integration-tokens.ts`.

Why this matters: stored OAuth/provider tokens are encrypted with the active
key. Generating and deploying a new key before re-encrypting existing
`IntegrationToken` rows can make Apollo, Seamless, Dust, HubSpot, Gmail,
Microsoft Graph, and future MCP-backed integrations fail after restart. The
safe default is to block key replacement before a new key is generated.

Implementation:

- `scripts/ops/rotate-secrets.sh` declares the required rotation tool path.
- The `INTEGRATION_TOKEN_KEY` step checks for that tool before generating
  `NEW_KEY`.
- Blocked rotations are written to `docs/operations/secret-rotation.log`.
- Operator copy no longer claims `pnpm db:migrate` performs token
  re-encryption.
- The post-rotation checklist removes `INTEGRATION_TOKEN_KEY_PREV` only after
  token re-encryption succeeds.
- `scripts/verify-secret-rotation-policy.mjs` guards the operator workflow with
  good and poisoned fixtures.

Verification:

- `pnpm deploy:evidence:secret-rotation:policy`: pass.
- `pnpm deploy:evidence:secret-rotation:policy:selftest`: pass.
- `bash -n scripts/ops/rotate-secrets.sh`: pass.
- `node --check scripts/verify-secret-rotation-policy.mjs`: pass.
- `pnpm exec eslint --no-ignore --no-warn-ignored scripts/verify-secret-rotation-policy.mjs --max-warnings=0`:
  pass.
- `pnpm deploy:evidence:selftest`: pass.
- `pnpm deploy:evidence:source:selftest`: pass.
- `pnpm deploy:evidence:source`: expected release block; worktree has 395
  dirty entries.
- `pnpm deploy:evidence:source:plan:write`: refreshed six active review waves.

## 2026-06-19: Integration Token Rotation Tool

`scripts/rotate-integration-tokens.ts` now implements the missing
`INTEGRATION_TOKEN_KEY` re-encryption step guarded by the quarterly rotation
workflow.

Pattern:

- Require explicit `OLD_INTEGRATION_TOKEN_KEY` and
  `NEW_INTEGRATION_TOKEN_KEY`; reject missing, malformed, or identical keys.
- Require an explicit `--dry-run` or `--apply` mode.
- Page through `IntegrationToken` rows in stable `id` order.
- Decrypt each token with the old key, re-encrypt with the new key, then verify
  the new ciphertext decrypts before any write.
- If a field already decrypts with the new key, mark it `alreadyRotated` and
  leave it untouched. This makes interrupted production rotations resumable.
- Never log plaintext tokens; row failures include token row id, provider, org,
  and a sanitized error.

Verification:

- `pnpm deploy:evidence:secret-rotation:tool:selftest`: pass.
- `pnpm deploy:evidence:secret-rotation:policy`: pass.
- `pnpm deploy:evidence:secret-rotation:policy:selftest`: pass.
- `pnpm exec eslint --no-ignore --no-warn-ignored scripts/verify-secret-rotation-policy.mjs scripts/rotate-integration-tokens.ts --max-warnings=0`:
  pass.
- `pnpm exec tsc --noEmit --pretty false --module NodeNext --moduleResolution NodeNext --target ES2022 --lib ES2023 --types node --skipLibCheck scripts/rotate-integration-tokens.ts`:
  pass.
- `pnpm deploy:evidence:source`: expected release block; worktree has 395
  dirty entries.
- `pnpm deploy:evidence:source:plan:write`: pass; refreshed six active review
  waves with P0 security/auth/access at 60 files.
