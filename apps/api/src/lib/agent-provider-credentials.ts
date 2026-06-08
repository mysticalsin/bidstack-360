import { prisma } from '@bidstack/db';
import type { AgentProvider } from '@bidstack/shared';
import { decryptSecret } from '@bidstack/shared/server-crypto';

export const AGENT_PROVIDER_CREDENTIAL_PREFIX = 'agent-provider:';
export const AGENT_PROVIDER_CONFIG_TYPE = 'dust';

export const DIRECT_AGENT_PROVIDERS = [
  'claude',
  'openai',
  'kimi',
  'nvidia_nim',
  'gemma',
] as const satisfies AgentProvider[];

export type DirectAgentProvider = (typeof DIRECT_AGENT_PROVIDERS)[number];

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

export function isDirectAgentProvider(provider: AgentProvider): provider is DirectAgentProvider {
  return DIRECT_AGENT_PROVIDERS.includes(provider as DirectAgentProvider);
}

export function agentProviderCredentialName(provider: DirectAgentProvider): string {
  return `${AGENT_PROVIDER_CREDENTIAL_PREFIX}${provider}`;
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
