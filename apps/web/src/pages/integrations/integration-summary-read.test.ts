import { describe, expect, it } from 'vitest';

import { buildIntegrationSummary } from './integration-helpers';
import type { DustStatus, IntegrationSetupGuide } from './types';

/**
 * The integrations posture is built before the setup contract and the Dust
 * status return. Missing arguments are an unread or failed read, not a
 * settled configuration.
 */
function settledGuide(overrides: Partial<IntegrationSetupGuide> = {}): IntegrationSetupGuide {
  return {
    generatedAt: '2026-11-26T00:00:00.000Z',
    dust: {
      configured: true,
      workspaceId: 'ws_demo',
      dataSourceConfigured: true,
      webhookReceiverUrl: 'https://example.test/dust',
    },
    mcp: {
      publicUrl: 'https://example.test/mcp',
      healthUrl: 'https://example.test/mcp/health',
      wellKnownUrl: 'https://example.test/.well-known/mcp',
      transport: 'streamable-http',
      configured: true,
      readScopes: ['mcp', 'read'],
      writeScopes: ['mcp', 'write'],
    },
    rest: {
      baseUrl: 'https://example.test/api',
      authHeader: 'Authorization: Bearer',
      recommendedScopes: ['read'],
    },
    webhooks: {
      subscriptionsUrl: 'https://example.test/hooks',
      receiverUrl: 'https://example.test/receiver',
      requiredHeaders: ['X-Signature'],
      recommendedEvents: ['deal.updated'],
    },
    snippets: {
      dustMcpToolConfig: '{}',
      mcpHealthCheck: 'GET /health',
      restOpportunitySearch: 'GET /opportunities',
      webhookReceiver: '{}',
    },
    ...overrides,
  };
}

function settledDust(overrides: Partial<DustStatus> = {}): DustStatus {
  return {
    workspace: 'demo',
    lastSyncAt: null,
    nextSyncAt: null,
    lastError: null,
    pulled24h: 0,
    pushed24h: 0,
    configured: true,
    agentsError: null,
    agents: [],
    ...overrides,
  };
}

describe('integration summary read', () => {
  it('does not call an unread setup contract needs setup, ready, or not synced', () => {
    // WHY: IntegrationsSection passes setupGuide.data and status.data straight
    // through. Until those queries settle, both are undefined, including a
    // paused read and a failed read that stored nothing. The control-plane
    // card prints postureLabel, and the Dust metric prints latestSyncLabel.
    // "Needs setup", "Ready", and "Not synced" are judgments of a payload
    // that has not arrived.
    const summary = buildIntegrationSummary(undefined, undefined, []);

    expect(summary.postureLabel).not.toBe('Needs setup');
    expect(summary.postureLabel).not.toBe('Ready');
    expect(summary.postureTone).not.toBe('jade');
    expect(summary.latestSyncLabel).not.toBe('Not synced');
    expect(summary.postureLabel).toBe('Setup contract has not arrived');
    expect(summary.latestSyncLabel).toBe('Sync time has not arrived');
  });

  it('still says needs setup after a settled contract that is not configured', () => {
    // WHY: a returned contract with Dust or MCP off is a real gap. Waiting
    // copy must not hide it.
    const guide = settledGuide({
      dust: {
        configured: false,
        workspaceId: null,
        dataSourceConfigured: false,
        webhookReceiverUrl: 'https://example.test/dust',
      },
      mcp: {
        ...settledGuide().mcp,
        configured: false,
      },
    });
    const summary = buildIntegrationSummary(guide, settledDust(), []);

    expect(summary.postureLabel).toBe('Needs setup');
    expect(summary.postureTone).toBe('amber');
    expect(summary.latestSyncLabel).toBe('Not synced');
  });

  it('says ready only after a settled contract with nothing left to fix', () => {
    // WHY: Ready is a claim that the setup contract arrived and the paths
    // it describes are configured. An unread contract must not take this branch.
    const summary = buildIntegrationSummary(
      settledGuide(),
      settledDust({ lastSyncAt: '2026-11-26T12:00:00.000Z' }),
      [],
    );

    expect(summary.postureLabel).toBe('Ready');
    expect(summary.postureTone).toBe('jade');
    expect(summary.latestSyncLabel).not.toBe('Not synced');
    expect(summary.latestSyncLabel).not.toBe('Sync time has not arrived');
  });
});
