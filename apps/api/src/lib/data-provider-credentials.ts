// Per-org encrypted API keys for EXTERNAL data sources (enrichment / intent).
// Mirrors the agent-provider (LLM) credential pattern: keys live encrypted in
// integration_configs, org-scoped, set/tested from Settings → never in code or a
// shared env. Adding a new source is a one-line catalog entry + a tester.

import { prisma } from '@bidstack/db';
import { decryptSecret } from '@bidstack/shared/server-crypto';

// Reuse the existing integration_type enum value + a distinct name prefix so
// these rows don't collide with the LLM agent-provider rows.
export const DATA_PROVIDER_CONFIG_TYPE = 'dust';
export const DATA_PROVIDER_PREFIX = 'data-provider:';

/** Catalog of supported data sources. Add one here + a tester to expose it. */
export const DATA_PROVIDERS = ['seamless'] as const;
export type DataProvider = (typeof DATA_PROVIDERS)[number];

export const DATA_PROVIDER_META: Record<
  DataProvider,
  { label: string; docsUrl: string; description: string }
> = {
  seamless: {
    label: 'Seamless.AI',
    docsUrl: 'https://docs.seamless.ai/',
    description: 'Company + contact enrichment (employees, revenue, tech, funding, news).',
  },
};

export function isDataProvider(value: string): value is DataProvider {
  return (DATA_PROVIDERS as readonly string[]).includes(value);
}

export function dataProviderName(provider: DataProvider): string {
  return `${DATA_PROVIDER_PREFIX}${provider}`;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

/**
 * Decrypt the org's API key for a data provider, or null when not configured.
 * Decryption failures resolve to null (caller falls back to env / open source).
 */
export async function resolveDataProviderApiKey(
  orgId: string,
  provider: DataProvider,
): Promise<string | null> {
  const rows = await prisma.$queryRaw<{ credentials: unknown }[]>`
    SELECT credentials
    FROM integration_configs
    WHERE org_id = ${orgId}::uuid
      AND type::text = ${DATA_PROVIDER_CONFIG_TYPE}
      AND name = ${dataProviderName(provider)}
      AND is_active = true
      AND deleted_at IS NULL
    LIMIT 1
  `;
  const encrypted = str(asRecord(rows[0]?.credentials).encrypted);
  if (!encrypted) return null;
  try {
    return str((JSON.parse(decryptSecret(encrypted)) as { apiKey?: unknown }).apiKey) ?? null;
  } catch {
    return null;
  }
}

export interface DataProviderStatus {
  provider: DataProvider;
  configured: boolean;
  updatedAt: string | null;
}

/** Configured-or-not status for every catalog provider (no secrets returned). */
export async function listDataProviderStatuses(orgId: string): Promise<DataProviderStatus[]> {
  const rows = await prisma.$queryRaw<{ name: string; updatedAt: Date }[]>`
    SELECT name, updated_at AS "updatedAt"
    FROM integration_configs
    WHERE org_id = ${orgId}::uuid
      AND type::text = ${DATA_PROVIDER_CONFIG_TYPE}
      AND name LIKE ${`${DATA_PROVIDER_PREFIX}%`}
      AND is_active = true
      AND deleted_at IS NULL
  `;
  const byProvider = new Map(rows.map((r) => [r.name, r.updatedAt]));
  return DATA_PROVIDERS.map((provider) => {
    const updatedAt = byProvider.get(dataProviderName(provider)) ?? null;
    return {
      provider,
      configured: updatedAt !== null,
      updatedAt: updatedAt ? updatedAt.toISOString() : null,
    };
  });
}
