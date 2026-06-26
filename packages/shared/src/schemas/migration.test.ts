import { describe, expect, it } from 'vitest';

import { MigrationJobPayload } from './migration.js';

const basePayload = {
  migrationJobId: '11111111-1111-4111-8111-111111111111',
  orgId: '22222222-2222-4222-8222-222222222222',
  userId: '33333333-3333-4333-8333-333333333333',
  source: 'HUBSPOT_OAUTH',
  entityType: 'companies',
  chunkOffset: 0,
  chunkSize: 100,
  totalRows: 10,
  mappings: { name: 'company.name' },
  dedupStrategy: 'update',
} as const;

describe('MigrationJobPayload secret hygiene', () => {
  it('allows non-secret provider references in queue metadata', () => {
    const parsed = MigrationJobPayload.parse({
      ...basePayload,
      meta: { hubspotIntegrationConfigId: '44444444-4444-4444-8444-444444444444' },
    });

    expect(parsed.meta).toEqual({
      hubspotIntegrationConfigId: '44444444-4444-4444-8444-444444444444',
    });
  });

  it('rejects raw provider tokens in queue metadata', () => {
    const result = MigrationJobPayload.safeParse({
      ...basePayload,
      meta: {
        accessToken: 'hubspot-access-token',
        nested: { refreshToken: 'hubspot-refresh-token' },
      },
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path.join('.'))).toEqual([
      'meta.accessToken',
      'meta.nested.refreshToken',
    ]);
  });
});
