// Per-org LLM resolver for the worker.
//
// Vendor-independence: an org picks its active provider in Settings → Integrations
// (Claude / GPT / Kimi / NVIDIA NIM / local Gemma) and that selection drives every
// AI step — RFP drafting, contract extraction — with NO redeploy. This reads the
// org's active-provider selector + its encrypted key from `integration_configs`
// (the same rows the API writes) and returns a runnable ResolvedLlm.
//
// Precedence in callers: org provider (here) → deployment env (resolveLlmFromEnv)
// → Dust workspace → deterministic fallback. Returns null when the org has not
// chosen a provider or its key is missing, so the caller falls through cleanly.
//
// Security: the decrypted key is only placed in the ResolvedLlm and sent in the
// provider request header. It is NEVER logged.

import { prisma } from '@bidstack/db';
import { decryptSecret } from '@bidstack/shared/server-crypto';
import {
  AGENT_PROVIDER_ACTIVE_NAME,
  AGENT_PROVIDER_CONFIG_TYPE,
  agentProviderCredentialName,
  buildResolvedLlm,
  isDirectAgentProvider,
  type DirectAgentProviderId,
  type ResolvedLlm,
} from '@bidstack/shared/llm';

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

async function readConfigRow(
  orgId: string,
  name: string,
): Promise<{ config: unknown; credentials: unknown } | null> {
  const rows = await prisma.$queryRaw<{ config: unknown; credentials: unknown }[]>`
    SELECT config, credentials
    FROM integration_configs
    WHERE org_id = ${orgId}::uuid
      AND type::text = ${AGENT_PROVIDER_CONFIG_TYPE}
      AND name = ${name}
      AND is_active = true
      AND deleted_at IS NULL
    LIMIT 1
  `;
  return rows[0] ?? null;
}

/**
 * Resolve the org's active LLM provider into a runnable client, or null when no
 * provider is chosen / its key is missing. Decryption failures resolve to null
 * (caller falls back to env/Dust) rather than throwing the whole job.
 */
export async function resolveOrgLlm(orgId: string): Promise<ResolvedLlm | null> {
  const activeRow = await readConfigRow(orgId, AGENT_PROVIDER_ACTIVE_NAME);
  const provider = str(asRecord(activeRow?.config).provider);
  if (!provider || !isDirectAgentProvider(provider)) return null;

  const credRow = await readConfigRow(orgId, agentProviderCredentialName(provider));
  if (!credRow) return null;

  const config = asRecord(credRow.config);
  const encrypted = str(asRecord(credRow.credentials).encrypted);
  let apiKey: string | undefined;
  if (encrypted) {
    try {
      apiKey = str((JSON.parse(decryptSecret(encrypted)) as { apiKey?: unknown }).apiKey);
    } catch {
      return null;
    }
  }

  // Gemma and OmniRoute are keyless local gateways; buildResolvedLlm supplies
  // their placeholder apiKey. Every other provider needs a real key.
  const isKeylessProvider = provider === 'gemma' || provider === 'omniroute';
  if (!isKeylessProvider && !apiKey) return null;

  return buildResolvedLlm({
    provider: provider as DirectAgentProviderId,
    apiKey,
    model: str(config.model),
    baseUrl: str(config.baseUrl),
  });
}
