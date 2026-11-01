import { describe, expect, it } from 'vitest';

import { buildIntegrationSummary } from './integration-helpers';
import type { DustStatus, IntegrationSetupGuide } from './types';

function guide(overrides: Partial<IntegrationSetupGuide['dust'] & IntegrationSetupGuide['mcp']> = {}): IntegrationSetupGuide {
  return {
    generatedAt: '2026-10-31T12:00:00.000Z',
    dust: {
      configured: overrides.configured ?? false,
      workspaceId: null,
      dataSourceConfigured: false,
      spaceConfigured: false,
      webhookReceiverUrl: 'http://localhost/webhooks/dust',
    },
    mcp: {
      publicUrl: 'http://localhost/mcp',
      healthUrl: 'http://localhost/health',
      wellKnownUrl: 'http://localhost/.well-known',
      transport: 'streamable-http',
      configured: false,
      localOnly: true,
      readScopes: ['read'],
      writeScopes: [],
    },
    rest: { baseUrl: 'http://localhost/api', authHeader: 'Authorization: Bearer', recommendedScopes: [] },
    webhooks: {
      subscriptionsUrl: 'http://localhost/webhooks',
      receiverUrl: 'http://localhost/webhooks/in',
      requiredHeaders: [],
      recommendedEvents: [],
    },
    snippets: {
      dustMcpToolConfig: '',
      mcpHealthCheck: '',
      restOpportunitySearch: '',
      webhookReceiver: '',
    },
  };
}

const dust: DustStatus = {
  workspace: 'local',
  lastSyncAt: null,
  nextSyncAt: null,
  lastError: null,
  pulled24h: 0,
  pushed24h: 0,
  configured: false,
  connectionState: 'stub',
  agentsError: null,
  agents: [],
};

describe('buildIntegrationSummary Dust posture', () => {
  it('stays unverified when no public URL and key exist', () => {
    const summary = buildIntegrationSummary(guide(), dust, []);
    expect(summary.postureLabel).toBe('Unverified / not connected');
    expect(summary.postureLabel).not.toMatch(/ready|healthy/i);
    expect(JSON.stringify(summary)).not.toContain('42');
  });

  it('does not report a live connection when a key exists but the MCP URL is local', () => {
    const summary = buildIntegrationSummary(
      guide({ configured: true }),
      { ...dust, configured: true, connectionState: 'configured_unverified' },
      [],
    );
    expect(summary.postureLabel).toBe('Unverified / not connected');
    expect(summary.postureTone).not.toBe('jade');
  });
});
