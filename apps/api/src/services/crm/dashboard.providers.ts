/**
 * dashboard.providers.ts — provider-health helpers for the CRM dashboard.
 *
 * Extracted from dashboard.service.ts (BS-R1 file-size refactor).
 * These functions call buildConnectorCatalog and so cannot be pure defaults;
 * they live here to keep dashboard.service.ts under 400 lines.
 */
import { type z } from 'zod';

import type { ProviderHealth } from '@bidstack/shared';

import { buildConnectorCatalog } from '../../providers/open-data-connectors.js';
import { asProviderStatus } from './dashboard.utils.js';

export function defaultProviderHealth(): Array<z.infer<typeof ProviderHealth>> {
  const checkedAt = new Date();
  const checked = checkedAt.toISOString();
  const coreProviders: Array<z.infer<typeof ProviderHealth>> = [
    {
      provider: 'External CRM GraphQL',
      status: 'healthy',
      latencyMs: 42,
      lastCheckedAt: checked,
      message: 'Core CRM adapter online',
    },
    {
      provider: 'Dust REST',
      status: process.env.DUST_API_KEY ? 'healthy' : 'disabled',
      latencyMs: null,
      lastCheckedAt: checked,
      message: process.env.DUST_API_KEY ? 'Agent jobs enabled' : 'Missing DUST_API_KEY',
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

  return [...coreProviders, ...connectorProviders].sort((a, b) =>
    a.provider.localeCompare(b.provider),
  );
}

export function mergeProviderHealth(
  persisted: Array<z.infer<typeof ProviderHealth>>,
): Array<z.infer<typeof ProviderHealth>> {
  const byProvider = new Map(defaultProviderHealth().map((row) => [row.provider, row]));
  for (const row of persisted) byProvider.set(row.provider, row);
  return [...byProvider.values()].sort((a, b) => a.provider.localeCompare(b.provider));
}
