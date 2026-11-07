import { WEBHOOK_EVENT_KEYS, WEBHOOK_MESSAGE_STATUSES } from '@bidstack/shared';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Panel, Shell, ShellHeader } from '@/components/vendor/tuffui/surface';
import { TickGauge } from '@/components/vendor/tuffui/tick-gauge';
import {
  useWebhookDeliveryStats,
  type WebhookDeliveryFilters,
  type WebhookDeliveryStats,
} from '@/hooks/useWebhookDeliveries';
import { cn } from '@/lib/cn';

import { endpointHost, hourLabel } from './webhook-format';

export interface EndpointOption {
  id: string;
  url: string;
}

const HOURS = Array.from({ length: 24 }, (_, h) => h);

const FIELD =
  'h-9 rounded-md border border-[var(--border-default)] bg-[var(--surface-card)] px-2.5 text-sm text-[var(--fg-primary)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)]';

/** Endpoint, event, status and time filters shared by the deliveries and message log tabs. */
export function WebhookFilterBar({
  subscriptions,
  filters,
  onFiltersChange,
}: {
  subscriptions: EndpointOption[];
  filters: WebhookDeliveryFilters;
  onFiltersChange: (patch: Partial<WebhookDeliveryFilters>) => void;
}) {
  const { t } = useTranslation('settings');
  const statusLabel: Record<string, string> = {
    succeeded: t('webhooks.status.succeeded', 'Delivered'),
    failed: t('webhooks.status.failed', 'Failed'),
    pending: t('webhooks.status.pending', 'Retrying'),
  };
  return (
    <div className="flex flex-wrap items-end gap-3">
      <label className="grid gap-1 text-xs font-medium text-[var(--fg-secondary)]">
        {t('webhooks.filter.endpoint', 'Endpoint')}
        <select
          className={cn(FIELD, 'max-w-60')}
          value={filters.subscriptionId ?? ''}
          onChange={(e) => onFiltersChange({ subscriptionId: e.target.value || undefined })}
        >
          <option value="">{t('webhooks.filter.allEndpoints', 'All endpoints')}</option>
          {subscriptions.map((s) => (
            <option key={s.id} value={s.id}>
              {endpointHost(s.url)}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-1 text-xs font-medium text-[var(--fg-secondary)]">
        {t('webhooks.filter.event', 'Event')}
        <select
          className={FIELD}
          value={filters.event ?? ''}
          onChange={(e) => onFiltersChange({ event: e.target.value || undefined })}
        >
          <option value="">{t('webhooks.filter.allEvents', 'All events')}</option>
          {WEBHOOK_EVENT_KEYS.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-1 text-xs font-medium text-[var(--fg-secondary)]">
        {t('webhooks.filter.status', 'Status')}
        <select
          className={FIELD}
          value={filters.status ?? ''}
          onChange={(e) =>
            onFiltersChange({
              status: (e.target.value || undefined) as WebhookDeliveryFilters['status'],
            })
          }
        >
          <option value="">{t('webhooks.filter.anyStatus', 'Any status')}</option>
          {WEBHOOK_MESSAGE_STATUSES.map((s) => (
            <option key={s} value={s}>
              {statusLabel[s]}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-1 text-xs font-medium text-[var(--fg-secondary)]">
        {t('webhooks.filter.time', 'Time')}
        <select
          className={FIELD}
          value={filters.window ?? '24h'}
          onChange={(e) =>
            onFiltersChange({ window: e.target.value as WebhookDeliveryFilters['window'] })
          }
        >
          <option value="24h">{t('webhooks.filter.last24h', 'Last 24 hours')}</option>
          <option value="7d">{t('webhooks.filter.last7d', 'Last 7 days')}</option>
          <option value="30d">{t('webhooks.filter.last30d', 'Last 30 days')}</option>
        </select>
      </label>
    </div>
  );
}

export function DeliveriesPanel({
  subscriptions,
  filters,
  onFiltersChange,
}: {
  subscriptions: EndpointOption[];
  filters: WebhookDeliveryFilters;
  onFiltersChange: (patch: Partial<WebhookDeliveryFilters>) => void;
}) {
  const { t } = useTranslation('settings');
  const stats = useWebhookDeliveryStats(filters);
  const data = stats.data;

  return (
    <div className="space-y-4">
      <WebhookFilterBar
        subscriptions={subscriptions}
        filters={filters}
        onFiltersChange={onFiltersChange}
      />
      {stats.isLoading ? (
        <p className="text-sm text-[var(--fg-secondary)]">
          {t('webhooks.deliveries.loading', 'Loading delivery stats…')}
        </p>
      ) : stats.isError || !data ? (
        <p role="alert" className="text-sm text-[var(--error-fg)]">
          {t('webhooks.deliveries.error', 'Could not load delivery stats. Refresh to try again.')}
        </p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,20rem),minmax(0,1fr)]">
          {data.successRate === null ? (
            <Shell>
              <ShellHeader title={t('webhooks.deliveries.successRate', 'Success rate')} />
              <Panel className="p-4 text-sm text-[var(--fg-secondary)]">
                {t(
                  'webhooks.deliveries.noSettled',
                  'No delivered or failed messages in this window yet.',
                )}
              </Panel>
            </Shell>
          ) : (
            <TickGauge
              value={data.successRate}
              title={t('webhooks.deliveries.successRate', 'Success rate')}
              caption={t('webhooks.deliveries.caption', '{{failed}} of {{total}} failed', {
                failed: data.messages.failed,
                total: data.messages.total,
              })}
              target={0.99}
              targetLabel="99%"
            />
          )}
          <AttemptsHeatmap subscriptions={subscriptions} stats={data} filters={filters} />
        </div>
      )}
    </div>
  );
}

function AttemptsHeatmap({
  subscriptions,
  stats,
  filters,
}: {
  subscriptions: EndpointOption[];
  stats: WebhookDeliveryStats;
  filters: WebhookDeliveryFilters;
}) {
  const { t } = useTranslation('settings');
  const [asTable, setAsTable] = useState(false);
  const rows = useMemo(
    () =>
      filters.subscriptionId
        ? subscriptions.filter((s) => s.id === filters.subscriptionId)
        : subscriptions,
    [filters.subscriptionId, subscriptions],
  );
  const cells = useMemo(() => {
    const map = new Map<string, { attempts: number; failures: number }>();
    for (const c of stats.heatmap) map.set(`${c.subscriptionId}:${c.hour}`, c);
    return map;
  }, [stats.heatmap]);
  const peak = Math.max(1, ...stats.heatmap.map((c) => c.attempts));
  const cellLabel = (host: string, hour: number, attempts: number, failures: number) =>
    t(
      'webhooks.heatmap.cell',
      '{{host}}, {{hour}} UTC: {{attempts}} attempts, {{failures}} failed',
      {
        host,
        hour: hourLabel(hour),
        attempts,
        failures,
      },
    );
  const title = t('webhooks.heatmap.title', 'Attempts by endpoint and hour');

  return (
    <Shell>
      <ShellHeader
        title={title}
        subtitle={t(
          'webhooks.heatmap.subtitle',
          'Hour of day in UTC. Darker cells carry more attempts; a red edge marks failures.',
        )}
        aside={
          <button
            type="button"
            onClick={() => setAsTable((v) => !v)}
            aria-pressed={asTable}
            className="h-8 rounded-md px-2.5 text-xs font-medium text-[var(--fg-secondary)] hover:bg-[var(--surface-sunken)] hover:text-[var(--fg-primary)] focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)]"
          >
            {asTable
              ? t('webhooks.heatmap.viewChart', 'View as chart')
              : t('webhooks.heatmap.viewTable', 'View as table')}
          </button>
        }
      />
      <Panel className="overflow-x-auto p-4">
        {rows.length === 0 ? (
          <p className="text-sm text-[var(--fg-secondary)]">
            {t('webhooks.heatmap.empty', 'Add an endpoint to see its delivery pattern.')}
          </p>
        ) : asTable ? (
          <table aria-label={title} className="w-full text-left text-xs tabular-nums">
            <thead className="text-[var(--fg-tertiary)]">
              <tr>
                <th scope="col" className="py-1 pr-3 font-medium">
                  {t('webhooks.heatmap.endpoint', 'Endpoint')}
                </th>
                <th scope="col" className="py-1 pr-3 font-medium">
                  {t('webhooks.heatmap.hour', 'Hour (UTC)')}
                </th>
                <th scope="col" className="py-1 pr-3 font-medium">
                  {t('webhooks.heatmap.attempts', 'Attempts')}
                </th>
                <th scope="col" className="py-1 font-medium">
                  {t('webhooks.heatmap.failures', 'Failed')}
                </th>
              </tr>
            </thead>
            <tbody className="text-[var(--fg-primary)]">
              {stats.heatmap
                .filter((c) => rows.some((r) => r.id === c.subscriptionId))
                .map((c) => {
                  const sub = rows.find((r) => r.id === c.subscriptionId)!;
                  return (
                    <tr
                      key={`${c.subscriptionId}:${c.hour}`}
                      className="border-t border-[var(--border-subtle)]"
                    >
                      <td className="py-1 pr-3 font-mono">{endpointHost(sub.url)}</td>
                      <td className="py-1 pr-3">{hourLabel(c.hour)}</td>
                      <td className="py-1 pr-3">{c.attempts}</td>
                      <td className="py-1">{c.failures}</td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        ) : (
          <div className="grid min-w-[36rem] grid-cols-[minmax(7rem,10rem),repeat(24,minmax(0,1fr))] items-center gap-0.5">
            <span />
            {HOURS.map((h) => (
              <span
                key={h}
                aria-hidden="true"
                className="text-center text-[0.625rem] text-[var(--fg-tertiary)]"
              >
                {h % 6 === 0 ? hourLabel(h) : ''}
              </span>
            ))}
            {rows.map((sub) => {
              const host = endpointHost(sub.url);
              return (
                <div key={sub.id} className="contents">
                  <span
                    className="truncate pr-2 font-mono text-xs text-[var(--fg-secondary)]"
                    title={sub.url}
                  >
                    {host}
                  </span>
                  {HOURS.map((h) => {
                    const c = cells.get(`${sub.id}:${h}`) ?? { attempts: 0, failures: 0 };
                    const level = c.attempts === 0 ? 0 : Math.max(0.15, c.attempts / peak);
                    return (
                      <span
                        key={h}
                        role="img"
                        aria-label={cellLabel(host, h, c.attempts, c.failures)}
                        title={cellLabel(host, h, c.attempts, c.failures)}
                        className={cn(
                          'block aspect-square rounded-sm',
                          c.attempts === 0 && 'bg-[var(--surface-sunken)]',
                          c.failures > 0 && 'ring-2 ring-inset ring-[var(--danger)]',
                        )}
                        style={
                          c.attempts > 0
                            ? {
                                backgroundColor: `color-mix(in oklab, var(--brand-deep) ${Math.round(level * 100)}%, transparent)`,
                              }
                            : undefined
                        }
                      />
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}
      </Panel>
    </Shell>
  );
}
