import { useQuery } from '@tanstack/react-query';

import { Card, SectionHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { LoadingSkeleton } from '@/components/ui/StateMessages';
import { api } from '@/lib/api';
import { formatDate, relativeTime } from '@/lib/format';

interface DustStatus {
  workspace: string;
  lastSyncAt: string | null;
  nextSyncAt: string | null;
  lastError: string | null;
  pulled24h: number;
  pushed24h: number;
}

interface WebhookEvent {
  id: string;
  receivedAt: string;
  source: string;
  eventType: string;
  status: string;
  error: string | null;
}

const MCP_TOOLS = [
  { name: 'opportunities.list', desc: 'List opportunities matching filters.' },
  { name: 'opportunities.get', desc: 'Fetch one opportunity with full intel.' },
  { name: 'opportunity.update', desc: 'Patch fields (stage, value, …) — writes audit log.' },
  { name: 'contacts.list', desc: 'List decision-unit contacts by customer.' },
  { name: 'tasks.create', desc: 'Create a follow-up task on an opportunity.' },
  { name: 'proposal.draft', desc: 'Draft a proposal section grounded in customer intel.' },
];

export function IntegrationsPage() {
  const status = useQuery({
    queryKey: ['dust:status'],
    queryFn: ({ signal }) => api<DustStatus>('/api/integrations/dust/status', { signal }),
  });
  const events = useQuery({
    queryKey: ['webhooks'],
    queryFn: ({ signal }) =>
      api<{ items: WebhookEvent[] }>('/api/integrations/webhooks', { signal }),
  });

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-[var(--fg-primary)] tracking-tight">
          Integrations
        </h1>
        <p className="mt-1 text-sm text-[var(--fg-secondary)]">
          Dust workspace sync, MCP server, and webhook activity.
        </p>
      </header>

      <Card>
        <SectionHeader
          title="Dust workspace"
          caption={status.data?.workspace}
          action={
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                api('/api/integrations/dust/resync', { method: 'POST' }).then(() =>
                  status.refetch(),
                )
              }
            >
              Force resync
            </Button>
          }
        />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 p-5">
          <Stat label="Last sync" value={status.data?.lastSyncAt ? formatDate(status.data.lastSyncAt) : '—'} />
          <Stat label="Next sync" value={status.data?.nextSyncAt ? formatDate(status.data.nextSyncAt) : '—'} />
          <Stat label="Pulled 24h" value={status.data?.pulled24h.toString() ?? '—'} />
          <Stat label="Pushed 24h" value={status.data?.pushed24h.toString() ?? '—'} />
        </div>
        {status.data?.lastError ? (
          <div className="mx-5 mb-5 rounded-md bg-[var(--danger-tint)] px-3 py-2 text-xs text-[var(--danger)]">
            {status.data.lastError}
          </div>
        ) : null}
      </Card>

      <Card>
        <SectionHeader title="MCP tools" caption="Exposed at /mcp on the MCP server" />
        <ul className="divide-y divide-[var(--border-subtle)]">
          {MCP_TOOLS.map((t) => (
            <li key={t.name} className="flex items-start justify-between gap-4 px-5 py-3">
              <div>
                <code className="font-mono text-xs text-[var(--brand-primary)]">{t.name}</code>
                <p className="mt-0.5 text-xs text-[var(--fg-secondary)]">{t.desc}</p>
              </div>
              <Badge tone="jade">active</Badge>
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
            {events.data?.items.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-3 px-5 py-2">
                <div className="flex items-center gap-2">
                  <span className="text-[var(--fg-tertiary)] tabular-nums">{relativeTime(e.receivedAt)}</span>
                  <Badge tone={e.source === 'dust.webhook' ? 'purple' : 'gray'}>{e.source}</Badge>
                  <span className="font-mono text-[var(--fg-primary)]">{e.eventType}</span>
                </div>
                <Badge
                  tone={e.status === 'processed' ? 'jade' : e.status === 'error' ? 'tomato' : 'gray'}
                >
                  {e.status}
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

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">
        {label}
      </div>
      <div className="mt-1 text-sm font-semibold text-[var(--fg-primary)] tabular-nums">{value}</div>
    </div>
  );
}
