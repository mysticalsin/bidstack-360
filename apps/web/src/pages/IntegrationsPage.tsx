import { useQuery } from '@tanstack/react-query';

import { ConnectorsSection } from '@/components/integrations/ConnectorsSection';
import { DataQualitySection } from '@/components/integrations/DataQualitySection';
import { OdooCard } from '@/components/integrations/OdooCard';
import { ProviderHealthSection } from '@/components/integrations/ProviderHealthSection';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, SectionHeader } from '@/components/ui/Card';
import { useIsAdmin } from '@/lib/auth';
import { ErrorState, LoadingSkeleton } from '@/components/ui/StateMessages';
import { api } from '@/lib/api';
import { formatDate, relativeTime } from '@/lib/format';

interface DustStatus {
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

interface WebhookEvent {
  id: string;
  receivedAt: string;
  source: string;
  eventType: string;
  status: string;
  error: string | null;
}

// Mirrors apps/mcp-server/src/tools/index.ts. Two namespaces ship side by side:
// the canonical Dust-facing `crm_*` surface and the legacy dotted MCP names
// retained for v0.1 clients.
type McpToolEntry = { name: string; desc: string; group: 'crm' | 'legacy' };

const MCP_TOOLS: ReadonlyArray<McpToolEntry> = [
  {
    group: 'crm',
    name: 'crm_search_companies',
    desc: 'Fuzzy search the company graph by name, domain, or registry.',
  },
  {
    group: 'crm',
    name: 'crm_enrich_company',
    desc: 'Trigger verified company enrichment and update the cache.',
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
    desc: 'Run the AI-insights generator for a deal or account.',
  },
  { group: 'legacy', name: 'opportunities.list', desc: 'List opportunities matching filters.' },
  { group: 'legacy', name: 'opportunities.get', desc: 'Fetch one opportunity with full intel.' },
  { group: 'legacy', name: 'opportunity.update', desc: 'Patch fields and write audit log.' },
  { group: 'legacy', name: 'contacts.list', desc: 'List decision-unit contacts by customer.' },
  { group: 'legacy', name: 'tasks.create', desc: 'Create a follow-up task on an opportunity.' },
  {
    group: 'legacy',
    name: 'proposal.draft',
    desc: 'Draft a proposal section grounded in customer intel.',
  },
];

export function IntegrationsPage() {
  const isAdmin = useIsAdmin();
  const status = useQuery({
    queryKey: ['dust:status'],
    queryFn: ({ signal }) => api<DustStatus>('/api/integrations/dust/status', { signal }),
  });
  const events = useQuery({
    queryKey: ['webhooks'],
    queryFn: ({ signal }) =>
      api<{ items: WebhookEvent[] }>('/api/integrations/webhooks', { signal }),
  });
  const isError = status.isError || events.isError;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-[var(--fg-primary)] tracking-tight">Integrations</h1>
        <p className="mt-1 text-sm text-[var(--fg-secondary)]">
          Dust workspace sync, MCP server, webhook activity, and verified source posture.
        </p>
      </header>

      {isError ? (
        <ErrorState
          title="Could not load integrations"
          message="Some integration data failed to load. Please try again."
          action={
            <button
              type="button"
              onClick={() => {
                if (status.isError) void status.refetch();
                if (events.isError) void events.refetch();
              }}
              className="inline-flex items-center justify-center rounded-lg bg-brand px-4 py-2 text-sm font-medium text-fg-on-brand hover:bg-brand-hover"
            >
              Retry
            </button>
          }
        />
      ) : null}

      <Card>
        <SectionHeader
          title="Dust workspace"
          caption={status.data?.workspace}
          action={
            <div className="flex items-center gap-2">
              {status.data ? (
                <Badge tone={status.data.configured ? 'jade' : 'amber'}>
                  {status.data.configured ? 'configured' : 'local stub'}
                </Badge>
              ) : null}
              {isAdmin ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    void api('/api/integrations/dust/resync', { method: 'POST' }).then(() =>
                      status.refetch(),
                    );
                  }}
                >
                  Force resync
                </Button>
              ) : null}
            </div>
          }
        />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 p-5">
          <Stat
            label="Last sync"
            value={status.data?.lastSyncAt ? formatDate(status.data.lastSyncAt) : 'n/a'}
          />
          <Stat
            label="Next sync"
            value={status.data?.nextSyncAt ? formatDate(status.data.nextSyncAt) : 'n/a'}
          />
          <Stat label="Pulled 24h" value={status.data?.pulled24h.toString() ?? 'n/a'} />
          <Stat label="Pushed 24h" value={status.data?.pushed24h.toString() ?? 'n/a'} />
        </div>
        {status.data?.lastError ? (
          <div className="mx-5 mb-5 rounded-md bg-[var(--danger-tint)] px-3 py-2 text-xs text-[var(--danger)]">
            {status.data.lastError}
          </div>
        ) : null}
      </Card>

      <DustAgentsCard data={status.data} isLoading={status.isLoading} />

      <OdooCard />

      <ProviderHealthSection />

      <ConnectorsSection />

      <DataQualitySection />

      <Card>
        <SectionHeader
          title="MCP tools"
          caption="Canonical crm_* names are consumed by Dust; legacy dotted names remain for v0.1 clients."
        />
        <ul className="divide-y divide-[var(--border-subtle)]">
          {MCP_TOOLS.map((tool) => (
            <li key={tool.name} className="flex items-start justify-between gap-4 px-5 py-3">
              <div>
                <code className="font-mono text-xs text-[var(--brand-primary)]">{tool.name}</code>
                <p className="mt-0.5 text-xs text-[var(--fg-secondary)]">{tool.desc}</p>
              </div>
              <Badge tone={tool.group === 'crm' ? 'jade' : 'gray'}>
                {tool.group === 'crm' ? 'active' : 'legacy'}
              </Badge>
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <SectionHeader title="Recent webhook events" />
        {events.isLoading ? (
          <LoadingSkeleton />
        ) : (
          <ul className="divide-y divide-[var(--border-subtle)] text-xs">
            {events.data?.items.map((event) => (
              <li key={event.id} className="flex items-center justify-between gap-3 px-5 py-2">
                <div className="flex items-center gap-2">
                  <span className="text-[var(--fg-tertiary)] tabular-nums">
                    {relativeTime(event.receivedAt)}
                  </span>
                  <Badge tone={event.source === 'dust.webhook' ? 'purple' : 'gray'}>
                    {event.source}
                  </Badge>
                  <span className="font-mono text-[var(--fg-primary)]">{event.eventType}</span>
                </div>
                <Badge
                  tone={
                    event.status === 'processed'
                      ? 'jade'
                      : event.status === 'error'
                        ? 'tomato'
                        : 'gray'
                  }
                >
                  {event.status}
                </Badge>
              </li>
            ))}
            {events.data?.items.length === 0 ? (
              <li className="px-5 py-6 text-[var(--fg-tertiary)]">No events yet.</li>
            ) : null}
          </ul>
        )}
      </Card>
    </div>
  );
}

function DustAgentsCard({ data, isLoading }: { data?: DustStatus; isLoading: boolean }) {
  return (
    <Card>
      <SectionHeader
        title="Dust agents"
        caption="Workspace assistants available for CRM enrichment and reasoning"
        action={
          data?.agentsError ? (
            <Badge tone="tomato">degraded</Badge>
          ) : data?.configured ? (
            <Badge tone="jade">live</Badge>
          ) : (
            <Badge tone="amber">disabled</Badge>
          )
        }
      />
      {isLoading ? (
        <div className="p-5">
          <LoadingSkeleton rows={3} />
        </div>
      ) : !data?.configured ? (
        <div className="px-5 py-6 text-sm text-[var(--fg-secondary)]">
          Set `DUST_API_KEY` and `DUST_WORKSPACE_ID` to list real Dust agents here. No placeholder
          agents are shown in local stub mode.
        </div>
      ) : data.agentsError ? (
        <div className="mx-5 my-5 rounded-md bg-[var(--danger-tint)] px-3 py-2 text-xs text-[var(--danger)]">
          {data.agentsError}
        </div>
      ) : data.agents.length === 0 ? (
        <div className="px-5 py-6 text-sm text-[var(--fg-secondary)]">
          Dust is configured, but no accessible agents were returned for this workspace.
        </div>
      ) : (
        <ul className="divide-y divide-[var(--border-subtle)]">
          {data.agents.map((agent) => (
            <li key={agent.id} className="flex items-start justify-between gap-4 px-5 py-3">
              <div>
                <div className="text-sm font-semibold text-[var(--fg-primary)]">{agent.label}</div>
                <code className="mt-1 block font-mono text-xs text-[var(--brand-primary)]">
                  {agent.id}
                </code>
                {agent.description ? (
                  <p className="mt-1 text-xs text-[var(--fg-secondary)]">{agent.description}</p>
                ) : null}
              </div>
              <Badge tone="purple">agent</Badge>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">
        {label}
      </div>
      <div className="mt-1 text-sm font-semibold text-[var(--fg-primary)] tabular-nums">
        {value}
      </div>
    </div>
  );
}
