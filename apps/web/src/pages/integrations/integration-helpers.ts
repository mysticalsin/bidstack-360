/**
 * integrations/integration-helpers.ts — pure (no-React) helper functions for
 * the Integrations feature area.
 *
 * WHY a separate module: these are side-effect-free transforms that are consumed
 * by multiple sibling components. Keeping them in a dedicated file makes them
 * independently testable without mounting any React tree.
 */
import type { BadgeTone } from '@/components/ui/Badge';
import { relativeTime } from '@/lib/format';

import type {
  IntegrationProbeResult,
  IntegrationSetupGuide,
  IntegrationSummary,
  DustStatus,
  ProbeKind,
  WebhookEvent,
} from './types';
import { MCP_TOOLS } from './types';

// ─── Summary builder ───────────────────────────────────────────────────────────

export function buildIntegrationSummary(
  guide: IntegrationSetupGuide | undefined,
  dust: DustStatus | undefined,
  events: WebhookEvent[],
): IntegrationSummary {
  const pathStates = [
    Boolean(guide?.dust.configured && guide?.mcp.configured),
    Boolean(guide?.mcp.configured),
    Boolean(guide?.rest.baseUrl),
    Boolean(guide?.webhooks.subscriptionsUrl),
  ];
  const attentionEvents = events.filter((event) => event.status === 'error').length;
  const needsSetup =
    !guide || !guide.mcp.configured || !guide.dust.configured || !guide.dust.dataSourceConfigured;

  return {
    readyPaths: pathStates.filter(Boolean).length,
    pathTotal: pathStates.length,
    dustAgents: dust?.agents.length ?? 0,
    webhookEvents: events.length,
    attentionEvents,
    activeMcpTools: MCP_TOOLS.filter((tool) => tool.group === 'crm').length,
    latestSyncLabel: dust?.lastSyncAt ? relativeTime(dust.lastSyncAt) : 'Not synced',
    postureLabel: needsSetup ? 'Needs setup' : attentionEvents > 0 ? 'Review events' : 'Ready',
    postureTone: needsSetup ? 'amber' : attentionEvents > 0 ? 'tomato' : 'jade',
  };
}

// ─── Webhook status tone ───────────────────────────────────────────────────────

export function webhookStatusTone(status: string): BadgeTone {
  if (status === 'processed') return 'jade';
  if (status === 'error') return 'tomato';
  return 'gray';
}

// ─── Connection path detail builder ───────────────────────────────────────────

type PathKey = 'dust' | 'mcp' | 'rest' | 'webhooks';

type PathDetail = {
  ready: boolean;
  description: string;
  endpointLabel: string;
  endpoint: string;
  snippetLabel: string;
  snippet: string;
  steps: Array<{ title: string; body: string }>;
};

export function getPathDetail(key: PathKey, guide: IntegrationSetupGuide): PathDetail {
  if (key === 'dust') {
    return {
      ready: guide.dust.configured && guide.mcp.configured,
      description:
        'Use REST to push knowledge into Dust data sources, then let Dust call BidStack through the public MCP endpoint.',
      endpointLabel: 'Dust webhook receiver',
      endpoint: guide.dust.webhookReceiverUrl,
      snippetLabel: 'Dust MCP tool config',
      snippet: guide.snippets.dustMcpToolConfig,
      steps: [
        {
          title: 'Create a scoped key',
          body: 'Use mcp + read for research agents. Add write only for approved automation agents.',
        },
        {
          title: 'Register the MCP tool',
          body: 'Paste the public MCP URL in Dust and set the Authorization bearer header.',
        },
        {
          title: 'Sync source evidence',
          body: 'Push proposals, opportunity briefs, and audit references through the REST data-source path.',
        },
      ],
    };
  }
  if (key === 'rest') {
    return {
      ready: true,
      description:
        'REST is the stable bi-directional interface for data sync, ETL, portals, and enterprise middleware.',
      endpointLabel: 'REST base URL',
      endpoint: guide.rest.baseUrl,
      snippetLabel: 'Opportunity search example',
      snippet: guide.snippets.restOpportunitySearch,
      steps: [
        {
          title: 'Choose scopes',
          body: `Recommended scopes: ${guide.rest.recommendedScopes.join(' + ')}. Avoid write for reporting jobs.`,
        },
        {
          title: 'Send bearer auth',
          body: guide.rest.authHeader,
        },
        {
          title: 'Make writes idempotent',
          body: 'External systems should send stable ids and retry safely when jobs or webhooks time out.',
        },
      ],
    };
  }
  if (key === 'webhooks') {
    return {
      ready: true,
      description:
        'Outbound subscriptions notify external systems when CRM events need realtime follow-up.',
      endpointLabel: 'Subscriptions API',
      endpoint: guide.webhooks.subscriptionsUrl,
      snippetLabel: 'Dust receiver test shape',
      snippet: guide.snippets.webhookReceiver,
      steps: [
        {
          title: 'Add HTTPS endpoint',
          body: 'Private/internal URLs are rejected before save to avoid SSRF risk.',
        },
        {
          title: 'Select events',
          body: `Start with ${guide.webhooks.recommendedEvents.slice(0, 3).join(', ')}.`,
        },
        {
          title: 'Verify signatures',
          body: `Expect ${guide.webhooks.requiredHeaders.join(', ')} on inbound Dust callbacks.`,
        },
      ],
    };
  }
  return {
    ready: guide.mcp.configured,
    description:
      'MCP gives agents a controlled tool surface. Read tools require mcp + read; write tools require mcp + write.',
    endpointLabel: 'MCP Streamable HTTP URL',
    endpoint: guide.mcp.publicUrl,
    snippetLabel: 'MCP health check',
    snippet: guide.snippets.mcpHealthCheck,
    steps: [
      {
        title: 'Expose the endpoint',
        body: guide.mcp.configured
          ? 'DUST_MCP_PUBLIC_URL is configured for external agent clients.'
          : 'Local fallback is shown. Set DUST_MCP_PUBLIC_URL before production use.',
      },
      {
        title: 'Create least-privilege key',
        body: `Read: ${guide.mcp.readScopes.join(' + ')}. Write: ${guide.mcp.writeScopes.join(' + ')}.`,
      },
      {
        title: 'Check discovery',
        body: `Discovery is available at ${guide.mcp.wellKnownUrl}.`,
      },
    ],
  };
}

// ─── Probe helpers ─────────────────────────────────────────────────────────────

export function defaultProbeUrl(kind: ProbeKind, guide: IntegrationSetupGuide): string {
  if (kind === 'rest') return `${guide.rest.baseUrl}/opportunities?limit=1`;
  if (kind === 'webhook') return guide.webhooks.receiverUrl;
  return guide.mcp.publicUrl;
}

export function readinessBadgeLabel(tone: 'jade' | 'amber' | 'teal' | 'blue' | 'gray'): string {
  if (tone === 'jade') return 'ok';
  if (tone === 'amber') return 'fix';
  if (tone === 'gray') return 'off';
  return 'live';
}

export function safeUrlPreview(value: string): string {
  try {
    const url = new URL(value);
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return 'Invalid endpoint URL';
  }
}

// Re-export the type so ConnectionCommandCenter can import PathKey from here
// without pulling in the full types.ts (avoids coupling to the shared file for
// an internal type).
export type { PathKey };

// Re-export IntegrationProbeResult for convenience (used by ConnectionTester and atoms)
export type { IntegrationProbeResult };
