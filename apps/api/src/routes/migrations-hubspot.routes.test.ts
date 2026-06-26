import { describe, expect, it } from 'vitest';

import {
  HUBSPOT_INTEGRATION_TYPE,
  HUBSPOT_MIGRATION_CONFIG_NAME,
  buildHubSpotMigrationPayload,
  hubspotIntegrationConfigKey,
  hubspotIntegrationConfigWhere,
} from './migrations-hubspot.routes.js';

describe('HubSpot migration IntegrationConfig coordinates', () => {
  it('uses the dedicated HubSpot integration type for OAuth storage and lookup', () => {
    expect(HUBSPOT_INTEGRATION_TYPE).toBe('hubspot');
    expect(HUBSPOT_MIGRATION_CONFIG_NAME).toBe('hubspot-migration');

    expect(hubspotIntegrationConfigKey('org-1')).toEqual({
      orgId_type_name: {
        orgId: 'org-1',
        type: 'hubspot',
        name: 'hubspot-migration',
      },
    });

    expect(hubspotIntegrationConfigWhere('org-1')).toEqual({
      orgId: 'org-1',
      type: 'hubspot',
      name: 'hubspot-migration',
      isActive: true,
    });

    expect(JSON.stringify(hubspotIntegrationConfigKey('org-1'))).not.toContain('salesforce');
    expect(JSON.stringify(hubspotIntegrationConfigWhere('org-1'))).not.toContain('salesforce');
  });

  it('builds HubSpot queue payloads with a credential reference, not OAuth tokens', () => {
    const payload = buildHubSpotMigrationPayload({
      migrationJobId: '11111111-1111-4111-8111-111111111111',
      orgId: '22222222-2222-4222-8222-222222222222',
      userId: '33333333-3333-4333-8333-333333333333',
      entityType: 'companies',
      totalRows: 25,
      mappings: { name: 'company.name' },
      dedupStrategy: 'update',
      hubspotIntegrationConfigId: '44444444-4444-4444-8444-444444444444',
    });

    expect(payload.meta).toEqual({
      hubspotIntegrationConfigId: '44444444-4444-4444-8444-444444444444',
    });
    expect(JSON.stringify(payload)).not.toContain('accessToken');
    expect(JSON.stringify(payload)).not.toContain('refreshToken');
  });
});
