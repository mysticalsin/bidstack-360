/**
 * integrations/types.ts — shared TypeScript interfaces and constants for the
 * Integrations feature area.
 *
 * WHY a separate module: types are consumed by multiple sibling files (helpers,
 * atoms, hero, command center, tester, agents). Extracting them here prevents
 * circular imports and makes the dependency graph acyclic.
 */
import type { BadgeTone } from '@/components/ui/Badge';

// ─── API response shapes ───────────────────────────────────────────────────────

export interface DustStatus {
  workspace: string;
  lastSyncAt: string | null;
  nextSyncAt: string | null;
  lastError: string | null;
  pulled24h: number;
  pushed24h: number;
  configured: boolean;
  agentsError: string | null;
  agents: Array<{ id: string; label: string; description: string | null }>;
}

export interface WebhookEvent {
  id: string;
  receivedAt: string;
  source: string;
  eventType: string;
  status: string;
  error: string | null;
}

export interface IntegrationSetupGuide {
  generatedAt: string;
  dust: {
    configured: boolean;
    workspaceId: string | null;
    dataSourceConfigured: boolean;
    webhookReceiverUrl: string;
  };
  mcp: {
    publicUrl: string;
    healthUrl: string;
    wellKnownUrl: string;
    transport: 'streamable-http';
    configured: boolean;
    readScopes: string[];
    writeScopes: string[];
  };
  rest: {
    baseUrl: string;
    authHeader: string;
    recommendedScopes: string[];
  };
  webhooks: {
    subscriptionsUrl: string;
    receiverUrl: string;
    requiredHeaders: string[];
    recommendedEvents: string[];
  };
  snippets: {
    dustMcpToolConfig: string;
    mcpHealthCheck: string;
    restOpportunitySearch: string;
    webhookReceiver: string;
  };
}

export type ProbeKind = 'mcp' | 'rest' | 'webhook';

export interface IntegrationProbeResult {
  ok: boolean;
  status: number | null;
  latencyMs: number;
  checkedUrl: string;
  message: string;
  warnings: string[];
}

// ─── MCP tool registry ─────────────────────────────────────────────────────────

// Mirrors apps/mcp-server/src/tools/index.ts. Two namespaces ship side by side:
// the canonical Dust-facing `crm_*` surface and the legacy dotted MCP names
// retained for v0.1 clients.
export type McpToolEntry = { name: string; desc: string; group: 'crm' | 'legacy' };

export const MCP_TOOLS: ReadonlyArray<McpToolEntry> = [
  {
    group: 'crm',
    name: 'crm_search_companies',
    desc: 'Fuzzy search the company graph by name, domain, or registry.',
  },
  {
    group: 'crm',
    name: 'crm_enrich_company',
    desc: 'Request company data verification and refresh the cache.',
  },
  { group: 'crm', name: 'crm_create_deal', desc: 'Create an opportunity tied to a customer.' },
  {
    group: 'crm',
    name: 'crm_update_deal',
    desc: 'Patch deal fields and write an audit log entry.',
  },
  { group: 'crm', name: 'crm_list_activities', desc: 'List activities for a company or deal.' },
  {
    group: 'crm',
    name: 'crm_create_activity',
    desc: 'Log a new activity against a deal or contact.',
  },
  {
    group: 'crm',
    name: 'crm_generate_insights',
    desc: 'Generate draft insights from available CRM data for a deal or account.',
  },
  { group: 'legacy', name: 'opportunities.list', desc: 'List opportunities matching filters.' },
  {
    group: 'legacy',
    name: 'opportunities.get',
    desc: 'Fetch one opportunity with related CRM context.',
  },
  { group: 'legacy', name: 'opportunity.update', desc: 'Patch fields and write audit log.' },
  { group: 'legacy', name: 'contacts.list', desc: 'List decision-unit contacts by customer.' },
  { group: 'legacy', name: 'tasks.create', desc: 'Create a follow-up task on an opportunity.' },
  {
    group: 'legacy',
    name: 'proposal.draft',
    desc: 'Draft a proposal section using available customer context.',
  },
];

// ─── Summary shape ─────────────────────────────────────────────────────────────

export interface IntegrationSummary {
  readyPaths: number;
  pathTotal: number;
  dustAgents: number;
  webhookEvents: number;
  attentionEvents: number;
  activeMcpTools: number;
  latestSyncLabel: string;
  postureLabel: string;
  postureTone: BadgeTone;
}
