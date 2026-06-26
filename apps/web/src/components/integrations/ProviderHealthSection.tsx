// Integrations -> Provider health. Polls /crm/provider-health on a 30s
// interval so on-call users can see which providers are healthy, degraded,
// disabled, or down without leaving the integrations page.

import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
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
  const { t } = useTranslation('crm');
  const { data, isLoading, isFetching, isError, error, refetch } = useProviderHealth();
  const test = useTestProviderHealth();
  const items = data?.items ? [...data.items].sort(byStatus) : [];

  const runTest = () =>
    test.mutate(undefined, {
      onSuccess: (res) => {
        const down = res.items.filter((p) => p.status === 'down').length;
        const disabled = res.items.filter((p) => p.status === 'disabled').length;
        toast.success(t('crm.providerHealth.toast.rechecked', 'Connections re-checked'), {
          description:
            down > 0
              ? down === 1
                ? t('crm.providerHealth.toast.downOne', '{{count}} provider down.', { count: down })
                : t('crm.providerHealth.toast.downMany', '{{count}} providers down.', { count: down })
              : t(
                  'crm.providerHealth.toast.allResponded',
                  'All reachable providers responded{{suffix}}.',
                  {
                    suffix: disabled
                      ? t('crm.providerHealth.toast.notConfiguredSuffix', ' · {{count}} not configured', {
                          count: disabled,
                        })
                      : '',
                  },
                ),
        });
      },
      onError: (err: Error) =>
        toast.error(t('crm.providerHealth.toast.testFailed', 'Could not run the test'), {
          description: err.message,
        }),
    });

  const downCount = items.filter((p) => p.status === 'down').length;
  const degradedCount = items.filter((p) => p.status === 'degraded').length;
  const caption = getCaption(t, {
    isLoading,
    isFetching,
    providerCount: items.length,
    downCount,
    degradedCount,
  });

  return (
    <Card className="overflow-hidden border-[var(--border-subtle)] bg-[var(--surface-primary)]">
      <SectionHeader
        title={t('crm.providerHealth.title', 'Provider health')}
        caption={caption}
        action={
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={runTest}
              disabled={test.isPending}
              aria-label={t('crm.providerHealth.testNowAria', 'Test all provider connections now')}
            >
              {test.isPending
                ? t('crm.providerHealth.testing', 'Testing…')
                : t('crm.providerHealth.testNow', 'Test now')}
            </Button>
            <Badge tone={downCount > 0 ? 'tomato' : degradedCount > 0 ? 'amber' : 'jade'}>
              {isFetching
                ? t('crm.providerHealth.badge.refreshing', 'refreshing')
                : downCount + degradedCount > 0
                  ? t('crm.providerHealth.badge.attention', 'attention')
                  : t('crm.providerHealth.badge.stable', 'stable')}
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
          title={t('crm.providerHealth.error.title', 'Could not load provider health')}
          message={error instanceof Error ? error.message : undefined}
          action={
            <Button variant="secondary" size="sm" onClick={() => refetch()}>
              {t('crm.providerHealth.error.retry', 'Try again')}
            </Button>
          }
        />
      ) : items.length === 0 ? (
        <EmptyState title={t('crm.providerHealth.empty.title', 'No providers wired yet')} />
      ) : (
        <>
          <div className="grid gap-3 p-5 md:grid-cols-4">
            <ProviderStat
              icon="globe"
              label={t('crm.providerHealth.stat.providers', 'Providers')}
              value={String(items.length)}
              tone="blue"
            />
            <ProviderStat
              icon="checkCircle"
              label={t('crm.providerHealth.stat.healthy', 'Healthy')}
              value={String(items.filter((p) => p.status === 'healthy').length)}
              tone="jade"
            />
            <ProviderStat
              icon="warning"
              label={t('crm.providerHealth.stat.attention', 'Attention')}
              value={String(downCount + degradedCount)}
              tone={downCount > 0 ? 'tomato' : degradedCount > 0 ? 'amber' : 'gray'}
            />
            <ProviderStat
              icon="clock"
              label={t('crm.providerHealth.stat.medianLatency', 'Median latency')}
              value={medianLatencyLabel(t, items)}
              tone="teal"
            />
          </div>
          <div
            className="overflow-x-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)]"
            role="region"
            aria-label={t('crm.providerHealth.table.regionAria', 'Provider health table')}
            tabIndex={0}
          >
            <table className="w-full min-w-[760px] border-collapse text-left text-sm">
              <caption className="sr-only">
                {t('crm.providerHealth.table.caption', 'Provider health statuses')}
              </caption>
              <thead className="bg-[var(--surface-secondary)] text-xs uppercase tracking-[0.14em] text-[var(--text-muted)]">
                <tr>
                  <th scope="col" className="px-5 py-3 font-semibold">
                    {t('crm.providerHealth.table.provider', 'Provider')}
                  </th>
                  <th scope="col" className="px-5 py-3 font-semibold">
                    {t('crm.providerHealth.table.signal', 'Signal')}
                  </th>
                  <th scope="col" className="px-5 py-3 font-semibold">
                    {t('crm.providerHealth.table.checked', 'Checked')}
                  </th>
                  <th scope="col" className="px-5 py-3 text-right font-semibold">
                    {t('crm.providerHealth.table.status', 'Status')}
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
  const { t } = useTranslation('crm');
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
        {t('crm.providerHealth.stat.live', 'live')}
      </Badge>
    </div>
  );
}

function ProviderRow({ provider }: { provider: ProviderHealth }) {
  const { t } = useTranslation('crm');
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
              {provider.latencyMs !== null
                ? t('crm.providerHealth.row.latency', '{{ms}}ms response', { ms: provider.latencyMs })
                : t('crm.providerHealth.row.noLatency', 'No latency')}
            </div>
          </div>
        </div>
      </td>
      <td className="px-5 py-4">
        <p className="max-w-xl text-sm leading-6 text-[var(--text-secondary)]">
          {provider.message ||
            t('crm.providerHealth.row.normalResponse', 'Provider returned a normal health response.')}
        </p>
      </td>
      <td className="px-5 py-4 text-xs tabular-nums text-[var(--text-secondary)]">
        {relativeTime(provider.lastCheckedAt)}
      </td>
      <td className="px-5 py-4 text-right">
        <Badge tone={STATUS_TONE[provider.status]}>{statusLabel(t, provider.status)}</Badge>
      </td>
    </tr>
  );
}

function statusLabel(t: TFunction, status: ProviderHealth['status']): string {
  switch (status) {
    case 'healthy':
      return t('crm.providerHealth.status.healthy', 'healthy');
    case 'degraded':
      return t('crm.providerHealth.status.degraded', 'degraded');
    case 'down':
      return t('crm.providerHealth.status.down', 'down');
    case 'disabled':
      return t('crm.providerHealth.status.disabled', 'disabled');
  }
}

function medianLatencyLabel(t: TFunction, items: ProviderHealth[]) {
  const latencies = items
    .map((item) => item.latencyMs)
    .filter((value): value is number => typeof value === 'number')
    .sort((a, b) => a - b);
  if (latencies.length === 0) return t('crm.providerHealth.stat.naLatency', 'n/a');
  return `${latencies[Math.floor(latencies.length / 2)]}ms`;
}

function getCaption(
  t: TFunction,
  {
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
  },
) {
  if (isLoading) return t('crm.providerHealth.caption.loading', 'Checking provider status...');
  if (providerCount === 0)
    return t('crm.providerHealth.caption.none', 'No providers configured yet.');
  if (downCount + degradedCount === 0) {
    return t(
      'crm.providerHealth.caption.allHealthy',
      'All {{count}} providers reporting healthy{{suffix}}.',
      {
        count: providerCount,
        suffix: isFetching ? t('crm.providerHealth.caption.refreshingSuffix', ' - refreshing') : '',
      },
    );
  }
  return t(
    'crm.providerHealth.caption.issues',
    '{{down}} down, {{degraded}} degraded - auto-polling every 30s',
    { down: downCount, degraded: degradedCount },
  );
}

function byStatus(a: ProviderHealth, b: ProviderHealth) {
  const d = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
  return d !== 0 ? d : a.provider.localeCompare(b.provider);
}
