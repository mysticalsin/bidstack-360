import { prisma } from '@bidstack/db';
import { decryptSecret } from '@bidstack/shared/server-crypto';
import {
  AGENT_PROVIDER_ACTIVE_NAME,
  AGENT_PROVIDER_CONFIG_TYPE,
  AGENT_PROVIDER_CREDENTIAL_PREFIX,
  DIRECT_AGENT_PROVIDERS,
  agentProviderCredentialName,
  buildResolvedLlm,
  isDirectAgentProvider,
  type DirectAgentProviderId,
  type ResolvedLlm,
} from '@bidstack/shared/llm';

// Storage-key constants + provider id list now live in @bidstack/shared/llm so
// the worker reads the same keys it writes. Re-exported here for back-compat
// with the existing routes/imports.
export {
  AGENT_PROVIDER_CREDENTIAL_PREFIX,
  AGENT_PROVIDER_CONFIG_TYPE,
  AGENT_PROVIDER_ACTIVE_NAME,
  DIRECT_AGENT_PROVIDERS,
  agentProviderCredentialName,
  isDirectAgentProvider,
};

export type DirectAgentProvider = DirectAgentProviderId;

export type OrgAgentProviderCredential = {
  provider: DirectAgentProvider;
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  updatedAt: Date;
  source: 'org';
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function providerFromCredentialName(name: string): DirectAgentProvider | null {
  if (!name.startsWith(AGENT_PROVIDER_CREDENTIAL_PREFIX)) return null;
  const provider = name.slice(AGENT_PROVIDER_CREDENTIAL_PREFIX.length);
  return DIRECT_AGENT_PROVIDERS.includes(provider as DirectAgentProvider)
    ? (provider as DirectAgentProvider)
    : null;
}

function credentialFromRow(row: {
  name: string;
  config: unknown;
  credentials: unknown;
  updatedAt: Date;
}): OrgAgentProviderCredential | null {
  const provider = providerFromCredentialName(row.name);
  if (!provider) return null;

  const config = asRecord(row.config);
  const credentials = asRecord(row.credentials);
  const encrypted = str(credentials.encrypted);
  let apiKey: string | undefined;

  if (encrypted) {
    try {
      const parsed = JSON.parse(decryptSecret(encrypted)) as { apiKey?: unknown };
      apiKey = str(parsed.apiKey);
    } catch {
      return null;
    }
  }

  if (provider !== 'gemma' && !apiKey) return null;

  return {
    provider,
    apiKey,
    model: str(config.model),
    baseUrl: str(config.baseUrl),
    updatedAt: row.updatedAt,
    source: 'org',
  };
}

export async function resolveOrgAgentProviderCredential(
  orgId: string,
  provider: DirectAgentProvider,
): Promise<OrgAgentProviderCredential | null> {
  const rows = await prisma.$queryRaw<
    { name: string; config: unknown; credentials: unknown; updatedAt: Date }[]
  >`
    SELECT name, config, credentials, updated_at AS "updatedAt"
    FROM integration_configs
    WHERE org_id = ${orgId}::uuid
      AND type::text = ${AGENT_PROVIDER_CONFIG_TYPE}
      AND name = ${agentProviderCredentialName(provider)}
      AND is_active = true
      AND deleted_at IS NULL
    LIMIT 1
  `;
  return rows[0] ? credentialFromRow(rows[0]) : null;
}

export async function listOrgAgentProviderCredentials(
  orgId: string,
): Promise<OrgAgentProviderCredential[]> {
  const rows = await prisma.$queryRaw<
    { name: string; config: unknown; credentials: unknown; updatedAt: Date }[]
  >`
    SELECT name, config, credentials, updated_at AS "updatedAt"
    FROM integration_configs
    WHERE org_id = ${orgId}::uuid
      AND type::text = ${AGENT_PROVIDER_CONFIG_TYPE}
      AND name LIKE ${`${AGENT_PROVIDER_CREDENTIAL_PREFIX}%`}
      AND is_active = true
      AND deleted_at IS NULL
  `;
  return rows
    .map((row) => credentialFromRow(row))
    .filter((row): row is OrgAgentProviderCredential => row !== null);
}

/**
 * The org's active default provider, or null if none is selected. Stored as the
 * `agent-provider:__active__` selector row's `config.provider`. Vendor switching
 * is just rewriting this one value — no redeploy.
 */
export async function getOrgActiveAgentProvider(
  orgId: string,
): Promise<DirectAgentProvider | null> {
  const rows = await prisma.$queryRaw<{ config: unknown }[]>`
    SELECT config
    FROM integration_configs
    WHERE org_id = ${orgId}::uuid
      AND type::text = ${AGENT_PROVIDER_CONFIG_TYPE}
      AND name = ${AGENT_PROVIDER_ACTIVE_NAME}
      AND is_active = true
      AND deleted_at IS NULL
    LIMIT 1
  `;
  const provider = str(asRecord(rows[0]?.config).provider);
  return provider && isDirectAgentProvider(provider) ? provider : null;
}

/**
 * Map a stored org credential to a runnable {@link ResolvedLlm}. Returns null
 * when a non-Gemma provider has no key (can't call it). Used by the live
 * "test provider" ping; the worker has its own equivalent resolver.
 */
export function credentialToResolvedLlm(cred: OrgAgentProviderCredential): ResolvedLlm | null {
  if (cred.provider !== 'gemma' && !cred.apiKey) return null;
  return buildResolvedLlm({
    provider: cred.provider,
    apiKey: cred.apiKey,
    model: cred.model,
    baseUrl: cred.baseUrl,
  });
}
