import { describe, expect, it } from 'vitest';

import { FeatureFlags } from './feature-flags.js';
import { SerumRuntimePolicy, SerumStatusSnapshot } from './serum.js';

describe('SERUM schemas', () => {
  it('requires explicit feature flags for SERUM and demo mode', () => {
    expect(() =>
      FeatureFlags.parse({
        winLossDataAvailable: true,
        showRevenueBlock: true,
        infosearchEnabled: false,
        lms360Enabled: false,
        serumEnabled: false,
        serumDemoModeEnabled: false,
      }),
    ).not.toThrow();
  });

  it('accepts a source-backed status snapshot with disabled-safe defaults', () => {
    const parsed = SerumStatusSnapshot.parse({
      generatedAt: '2026-06-16T12:00:00.000Z',
      environment: 'development',
      enabled: false,
      demoModeEnabled: false,
      summary: {
        activeAgents: 0,
        activeLoops: 0,
        documentsProcessedToday: 0,
        failedJobs: 0,
        openApprovals: 0,
        modelCallsToday: 0,
        modelTokensToday: 0,
        providerConfigured: false,
        dustConfigured: false,
        mcpConfigured: false,
        latestConfigChangeAt: null,
      },
      cards: [
        {
          id: 'enabled',
          title: 'SERUM status',
          value: 'Disabled',
          detail: 'SERUM_ENABLED is false.',
          status: 'disabled',
        },
      ],
      modules: [
        {
          id: 'mission-control',
          label: 'Agent Mission Control',
          status: 'disabled',
          detail: 'Disabled until configured.',
        },
      ],
      providerHealth: [],
      queueHealth: [],
      signalHealth: [
        {
          id: 'source-tables',
          label: 'Source tables',
          status: 'ready',
          detail: '7/7 backend signal tables are available.',
        },
      ],
      guardrails: ['No fake production data or simulated agent activity.'],
    });

    expect(parsed.enabled).toBe(false);
    expect(parsed.demoModeEnabled).toBe(false);
    expect(parsed.signalHealth[0]?.status).toBe('ready');
  });

  it('accepts runtime policy snapshots with Dust/MCP Gateway controls', () => {
    const parsed = SerumRuntimePolicy.parse({
      generatedAt: '2026-06-17T15:30:00.000Z',
      environment: 'dev',
      agents: {
        activeConfigVersionId: null,
        activeConfigVersion: null,
        enabled: false,
        autonomy: 'disabled',
        allowedAgentIds: [],
        maxConcurrentRuns: 0,
        currentActiveRuns: 0,
        humanApprovalRequired: true,
      },
      loops: {
        activeConfigVersionId: null,
        activeConfigVersion: null,
        enabled: false,
        durableEventsRequired: true,
        stopOnApprovalGate: true,
        replayMode: 'manual_only',
        maxRetries: 1,
      },
      tools: {
        activeConfigVersionId: null,
        activeConfigVersion: null,
        enabled: false,
        registryMode: 'explicit_allowlist',
        allowedTools: [],
        allowWriteTools: false,
        requireDryRunForWriteTools: true,
      },
      connectors: {
        activeConfigVersionId: null,
        activeConfigVersion: null,
        enabled: false,
        connectorMode: 'read_only',
        requireConnectionTest: true,
        secretRefs: [],
      },
      modelRouter: {
        activeConfigVersionId: null,
        activeConfigVersion: null,
        defaultProvider: null,
        fallbackProvider: null,
        effectiveProvider: null,
        providerConfigured: false,
        maxTokensPerRequest: 4000,
        requireSourceCitations: true,
        uncertaintyMode: 'answer_with_limits',
      },
      dustMcpGateway: {
        activeConfigVersionId: null,
        activeConfigVersion: null,
        dustEnabled: false,
        mcpEnabled: false,
        writeMode: 'disabled',
        secretRefs: [],
        requireToolAudit: true,
      },
      retrieval: {
        activeConfigVersionId: null,
        activeConfigVersion: null,
        enabled: false,
        requireGroundedSources: true,
        minimumConfidence: 0.72,
        maxChunks: 8,
        noSourceBehavior: 'say_uncertain',
      },
      promptLibrary: {
        activeConfigVersionId: null,
        activeConfigVersion: null,
        versionedPromptsRequired: true,
        promptInjectionTestsRequired: true,
        approvalRequiredForProduction: true,
        allowedPromptSets: [],
      },
      evalsQualityGates: {
        activeConfigVersionId: null,
        activeConfigVersion: null,
        requiredBeforePublish: true,
        minimumPassRate: 0.98,
        regressionSuites: [],
        blockOnFailure: true,
      },
    });

    expect(parsed.dustMcpGateway.dustEnabled).toBe(false);
    expect(parsed.loops.enabled).toBe(false);
    expect(parsed.loops.stopOnApprovalGate).toBe(true);
    expect(parsed.dustMcpGateway.requireToolAudit).toBe(true);
    expect(parsed.connectors.connectorMode).toBe('read_only');
    expect(parsed.retrieval.enabled).toBe(false);
    expect(parsed.promptLibrary.versionedPromptsRequired).toBe(true);
    expect(parsed.evalsQualityGates.minimumPassRate).toBe(0.98);
  });
});
