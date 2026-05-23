// Integrations -> Provider health. Polls /crm/provider-health on a 30s
// interval so on-call users can see which providers are healthy, degraded,
// disabled, or down without leaving the integrations page.

import { Card, SectionHeader } from '@/components/ui/Card';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { ErrorState, LoadingSkeleton, EmptyState } from '@/components/ui/StateMessages';
import { useProviderHealth } from '@/hooks/useCrmIntegrations';
import { relativeTime } from '@/lib/format';
import type { ProviderHealth } from '@bidstack/shared';

const STATUS_TONE: Record<ProviderHealth['status'], BadgeTone> = {
  healthy: 'jade',
  degraded: 'amber',
  down: 'tomato',
  disabled: 'gray',
};

const STATUS_ORDER: Record<ProviderHealth['status'], number> = {
  down: 0,
  degraded: 1,
  healthy: 2,
  disabled: 3,
};

export function ProviderHealthSection() {
  const { data, isLoading, isFetching, isError, error, refetch } = useProviderHealth();
  const items = data?.items ? [...data.items].sort(byStatus) : [];

  const downCount = items.filter((p) => p.status === 'down').length;
  const degradedCount = items.filter((p) => p.status === 'degraded').length;
  const caption = getCaption({
    isLoading,
    isFetching,
    providerCount: items.length,
    downCount,
    degradedCount,
  });

  return (
    <Card>
      <SectionHeader title="Provider health" caption={caption} />
      {isLoading ? (
        <LoadingSkeleton rows={3} />
      ) : isError ? (
        <ErrorState
          title="Could not load provider health"
          message={error instanceof Error ? error.message : undefined}
          action={
            <button
              type="button"
              className="text-xs text-[var(--brand-primary)] underline"
              onClick={() => refetch()}
            >
              Try again
            </button>
          }
        />
      ) : items.length === 0 ? (
        <EmptyState title="No providers wired yet" />
      ) : (
        <ul className="divide-y divide-[var(--border-subtle)]">
          {items.map((p) => (
            <li
              key={p.provider}
              className="flex flex-wrap items-center justify-between gap-3 px-5 py-3"
            >
              <div className="min-w-0">
                <div className="text-sm font-medium text-[var(--fg-primary)]">{p.provider}</div>
                <div className="mt-0.5 flex items-center gap-2 text-xs text-[var(--fg-tertiary)]">
                  <span>Checked {relativeTime(p.lastCheckedAt)}</span>
                  {p.latencyMs !== null ? (
                    <>
                      <span aria-hidden>.</span>
                      <span className="tabular-nums">{p.latencyMs}ms</span>
                    </>
                  ) : null}
                </div>
                {p.message ? (
                  <p className="mt-0.5 text-xs text-[var(--fg-secondary)]">{p.message}</p>
                ) : null}
              </div>
              <Badge tone={STATUS_TONE[p.status]}>{p.status}</Badge>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function getCaption({
  isLoading,
  isFetching,
  providerCount,
  downCount,
  degradedCount,
}: {
  isLoading: boolean;
  isFetching: boolean;
  providerCount: number;
  downCount: number;
  degradedCount: number;
}) {
  if (isLoading) return 'Checking provider status...';
  if (providerCount === 0) return 'No providers configured yet.';
  if (downCount + degradedCount === 0) {
    return `All ${providerCount} providers reporting healthy${isFetching ? ' - refreshing' : ''}.`;
  }
  return `${downCount} down, ${degradedCount} degraded - auto-polling every 30s`;
}

function byStatus(a: ProviderHealth, b: ProviderHealth) {
  const d = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
  return d !== 0 ? d : a.provider.localeCompare(b.provider);
}
