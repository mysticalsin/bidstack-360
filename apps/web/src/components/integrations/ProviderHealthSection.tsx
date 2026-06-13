// Integrations -> Provider health. Polls /crm/provider-health on a 30s
// interval so on-call users can see which providers are healthy, degraded,
// disabled, or down without leaving the integrations page.

import { Card, SectionHeader } from '@/components/ui/Card';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { ErrorState, LoadingSkeleton, EmptyState } from '@/components/ui/StateMessages';
import { Button } from '@/components/ui/Button';
import { Icon, type IconName } from '@/components/ui/Icon';
import { useProviderHealth, useTestProviderHealth } from '@/hooks/useCrmIntegrations';
import { toast } from '@/components/ui/Toast';
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
  const test = useTestProviderHealth();
  const items = data?.items ? [...data.items].sort(byStatus) : [];

  const runTest = () =>
    test.mutate(undefined, {
      onSuccess: (res) => {
        const down = res.items.filter((p) => p.status === 'down').length;
        const disabled = res.items.filter((p) => p.status === 'disabled').length;
        toast.success('Connections re-checked', {
          description:
            down > 0
              ? `${down} provider${down === 1 ? '' : 's'} down.`
              : `All reachable providers responded${disabled ? ` · ${disabled} not configured` : ''}.`,
        });
      },
      onError: (err: Error) => toast.error('Could not run the test', { description: err.message }),
    });

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
    <Card className="overflow-hidden border-[var(--border-subtle)] bg-[var(--surface-primary)]">
      <SectionHeader
        title="Provider health"
        caption={caption}
        action={
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={runTest}
              disabled={test.isPending}
              aria-label="Test all provider connections now"
            >
              {test.isPending ? 'Testing…' : 'Test now'}
            </Button>
            <Badge tone={downCount > 0 ? 'tomato' : degradedCount > 0 ? 'amber' : 'jade'}>
              {isFetching ? 'refreshing' : downCount + degradedCount > 0 ? 'attention' : 'stable'}
            </Badge>
          </div>
        }
      />
      {isLoading ? (
        <div className="p-5">
          <LoadingSkeleton rows={4} />
        </div>
      ) : isError ? (
        <ErrorState
          title="Could not load provider health"
          message={error instanceof Error ? error.message : undefined}
          action={
            <Button variant="secondary" size="sm" onClick={() => refetch()}>
              Try again
            </Button>
          }
        />
      ) : items.length === 0 ? (
        <EmptyState title="No providers wired yet" />
      ) : (
        <>
          <div className="grid gap-3 p-5 md:grid-cols-4">
            <ProviderStat
              icon="globe"
              label="Providers"
              value={String(items.length)}
              tone="blue"
            />
            <ProviderStat
              icon="checkCircle"
              label="Healthy"
              value={String(items.filter((p) => p.status === 'healthy').length)}
              tone="jade"
            />
            <ProviderStat
              icon="warning"
              label="Attention"
              value={String(downCount + degradedCount)}
              tone={downCount > 0 ? 'tomato' : degradedCount > 0 ? 'amber' : 'gray'}
            />
            <ProviderStat
              icon="clock"
              label="Median latency"
              value={medianLatencyLabel(items)}
              tone="teal"
            />
          </div>
          <div className="overflow-x-auto" role="region" aria-label="Provider health table">
            <table className="w-full min-w-[760px] border-collapse text-left text-sm">
              <caption className="sr-only">Provider health statuses</caption>
              <thead className="bg-[var(--surface-secondary)] text-xs uppercase tracking-[0.14em] text-[var(--text-muted)]">
                <tr>
                  <th scope="col" className="px-5 py-3 font-semibold">
                    Provider
                  </th>
                  <th scope="col" className="px-5 py-3 font-semibold">
                    Signal
                  </th>
                  <th scope="col" className="px-5 py-3 font-semibold">
                    Checked
                  </th>
                  <th scope="col" className="px-5 py-3 text-right font-semibold">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((provider) => (
                  <ProviderRow key={provider.provider} provider={provider} />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Card>
  );
}

function ProviderStat({
  icon,
  label,
  value,
  tone,
}: {
  icon: IconName;
  label: string;
  value: string;
  tone: BadgeTone;
}) {
  return (
    <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-secondary)] p-4">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-medium uppercase tracking-[0.14em] text-[var(--text-muted)]">
          {label}
        </span>
        <span className="grid size-8 place-items-center rounded-xl bg-[var(--surface-primary)] text-[var(--text-secondary)]">
          <Icon name={icon} className="size-4" />
        </span>
      </div>
      <div className="mt-4 text-xl font-semibold tabular-nums text-[var(--text-primary)]">
        {value}
      </div>
      <Badge tone={tone} className="mt-2">
        live
      </Badge>
    </div>
  );
}

function ProviderRow({ provider }: { provider: ProviderHealth }) {
  return (
    <tr className="border-b border-[var(--border-subtle)] align-top transition hover:bg-[var(--surface-secondary)]/70">
      <td className="px-5 py-4">
        <div className="flex items-start gap-3">
          <span className="mt-1 grid size-9 shrink-0 place-items-center rounded-2xl bg-[var(--surface-secondary)] text-[var(--text-secondary)]">
            <Icon name={provider.status === 'down' ? 'warning' : 'globe'} className="size-4" />
          </span>
          <div className="min-w-0">
            <div className="font-semibold text-[var(--text-primary)]">{provider.provider}</div>
            <div className="mt-1 text-xs tabular-nums text-[var(--text-muted)]">
              {provider.latencyMs !== null ? `${provider.latencyMs}ms response` : 'No latency'}
            </div>
          </div>
        </div>
      </td>
      <td className="px-5 py-4">
        <p className="max-w-xl text-sm leading-6 text-[var(--text-secondary)]">
          {provider.message || 'Provider returned a normal health response.'}
        </p>
      </td>
      <td className="px-5 py-4 text-xs tabular-nums text-[var(--text-secondary)]">
        {relativeTime(provider.lastCheckedAt)}
      </td>
      <td className="px-5 py-4 text-right">
        <Badge tone={STATUS_TONE[provider.status]}>{provider.status}</Badge>
      </td>
    </tr>
  );
}

function medianLatencyLabel(items: ProviderHealth[]) {
  const latencies = items
    .map((item) => item.latencyMs)
    .filter((value): value is number => typeof value === 'number')
    .sort((a, b) => a - b);
  if (latencies.length === 0) return 'n/a';
  return `${latencies[Math.floor(latencies.length / 2)]}ms`;
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
