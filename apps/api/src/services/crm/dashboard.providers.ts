/**
 * dashboard.providers.ts — provider-health helpers for the CRM dashboard.
 *
 * Extracted from dashboard.service.ts (BS-R1 file-size refactor).
 * These functions call buildConnectorCatalog and so cannot be pure defaults;
 * they live here to keep dashboard.service.ts under 400 lines.
 */
import { type z } from 'zod';

import {
  NOT_CONNECTED,
  connectProvider,
  providerApprovalFromEnv,
  ProviderHealth,
  type ProviderId,
} from '@bidstack/shared';

import { buildConnectorCatalog } from '../../providers/open-data-connectors.js';
import { asProviderStatus } from './dashboard.utils.js';

const NOT_A_LIVE_PROBE = 'Configuration is not a live probe.';

const PROVIDER_FLAG: Record<string, ProviderId> = {
  'External CRM GraphQL': 'external-crm',
  'Dust REST': 'dust',
  'MERX/Sovra': 'merx',
};

function presentProvider<T extends { provider: string; status: string; message: string | null; latencyMs: number | null }>(
  row: T,
): T {
  const id = PROVIDER_FLAG[row.provider];
  const approved = id ? providerApprovalFromEnv(process.env, id) : false;
  const decision = connectProvider(id ?? 'apollo', approved && id ? true : undefined);
  if (decision.ok) return row;
  return { ...row, status: 'disabled', latencyMs: null, message: NOT_CONNECTED };
}

export function defaultProviderHealth(): Array<z.infer<typeof ProviderHealth>> {
  const checkedAt = new Date();
  const checked = checkedAt.toISOString();
  const coreProviders: Array<z.infer<typeof ProviderHealth>> = [
    {
      provider: 'External CRM GraphQL',
      status: 'unverified',
      latencyMs: null,
      lastCheckedAt: checked,
      message: NOT_A_LIVE_PROBE,
    },
    {
      provider: 'Dust REST',
      status: 'unverified',
      latencyMs: null,
      lastCheckedAt: checked,
      message: process.env.DUST_API_KEY
        ? `DUST_API_KEY is set. ${NOT_A_LIVE_PROBE}`
        : `Missing DUST_API_KEY. ${NOT_A_LIVE_PROBE}`,
    },
    {
      provider: 'MERX/Sovra',
      status: 'disabled',
      latencyMs: null,
      lastCheckedAt: checked,
      message: 'Requires licensed feed or import',
    },
  ];
  const connectorProviders = buildConnectorCatalog(checkedAt).map((connector) => ({
    provider: connector.name,
    status: asProviderStatus(connector.status),
    latencyMs: null,
    lastCheckedAt: connector.lastCheckedAt,
    message: connector.message,
  }));

  return [...coreProviders, ...connectorProviders]
    .map((row) => presentProvider(row))
    .sort((a, b) => a.provider.localeCompare(b.provider));
}

export function mergeProviderHealth(
  persisted: Array<z.infer<typeof ProviderHealth>>,
): Array<z.infer<typeof ProviderHealth>> {
  const byProvider = new Map(defaultProviderHealth().map((row) => [row.provider, row]));
  for (const row of persisted) byProvider.set(row.provider, presentProvider(row));
  return [...byProvider.values()].sort((a, b) => a.provider.localeCompare(b.provider));
}
