import { useQuery } from '@tanstack/react-query';

import { Badge } from '@/components/ui/Badge';
import { Card, SectionHeader } from '@/components/ui/Card';
import { LoadingSkeleton } from '@/components/ui/StateMessages';
import { api } from '@/lib/api';

interface OdooStatus {
  configured: boolean;
  url: string | null;
  database: string | null;
  reachable: boolean;
  toolCount: number | null;
  lastError: string | null;
}

/**
 * Surfaces the Odoo MCP sidecar's connection state in the Integrations page.
 * Mirrors the Dust card so the visual rhythm of the page stays consistent:
 * left tone-badge for state, four-up stat grid, error tint if anything broke.
 */
export function OdooCard() {
  const status = useQuery({
    queryKey: ['odoo:status'],
    queryFn: ({ signal }) => api<OdooStatus>('/api/integrations/odoo/status', { signal }),
  });

  const tone = !status.data
    ? 'gray'
    : !status.data.configured
      ? 'amber'
      : status.data.reachable
        ? 'jade'
        : 'tomato';
  const label = !status.data
    ? 'checking…'
    : !status.data.configured
      ? 'not configured'
      : status.data.reachable
        ? 'live'
        : 'unreachable';

  return (
    <Card>
      <SectionHeader
        title="Odoo MCP"
        caption={status.data?.database ?? 'set ODOO_MCP_URL + ODOO_DB to enable'}
        action={<Badge tone={tone}>{label}</Badge>}
      />
      {status.isLoading ? (
        <div className="p-5">
          <LoadingSkeleton rows={2} />
        </div>
      ) : !status.data?.configured ? (
        <div className="px-5 py-6 text-sm text-[var(--fg-secondary)]">
          Set <code className="font-mono text-xs">ODOO_MCP_URL</code> (and optionally{' '}
          <code className="font-mono text-xs">ODOO_DB</code>) so the BidStack API can reach the
          mcp-server-odoo sidecar. The Odoo credentials themselves stay inside the sidecar — this
          app never sees them.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 p-5">
            <Stat label="Endpoint" value={hostOf(status.data.url)} />
            <Stat label="Database" value={status.data.database ?? '—'} />
            <Stat
              label="MCP tools"
              value={status.data.toolCount !== null ? status.data.toolCount.toString() : '—'}
            />
            <Stat label="Status" value={status.data.reachable ? 'reachable' : 'unreachable'} />
          </div>
          {status.data.lastError ? (
            <div className="mx-5 mb-5 rounded-md bg-[var(--danger-tint)] px-3 py-2 text-xs text-[var(--danger)]">
              {status.data.lastError}
            </div>
          ) : null}
        </>
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
      <div className="mt-1 text-sm font-semibold text-[var(--fg-primary)] tabular-nums truncate">
        {value}
      </div>
    </div>
  );
}

// Trim a URL down to host[:port] so the chip stays readable at the four-up
// density. The full URL is in env config; the UI just needs to identify it.
function hostOf(raw: string | null): string {
  if (!raw) return '—';
  try {
    const u = new URL(raw);
    return u.host || raw;
  } catch {
    return raw;
  }
}
