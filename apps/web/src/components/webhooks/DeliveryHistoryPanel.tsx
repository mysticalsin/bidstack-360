import { useState } from 'react';

import { Icon } from '@/components/ui/Icon';
import { ErrorState, LoadingSkeleton } from '@/components/ui/StateMessages';
import { useWebhookDeliveries, type WebhookDeliveryRecord } from '@/hooks/useWebhookSubscriptions';
import { cn } from '@/lib/cn';
import { relativeTime } from '@/lib/format';

export function DeliveryHistoryPanel({
  subscriptionId,
  id,
}: {
  subscriptionId: string;
  id: string;
}) {
  const deliveries = useWebhookDeliveries(subscriptionId);

  return (
    <div
      id={id}
      className="border-t border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-5 py-4"
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">
          Delivery history
        </h3>
        {deliveries.data?.hasMore ? (
          <span className="text-xs text-[var(--fg-tertiary)]">Showing 50 most recent</span>
        ) : null}
      </div>

      {deliveries.isLoading ? (
        <LoadingSkeleton rows={3} />
      ) : deliveries.isError ? (
        <ErrorState title="Failed to load" message="Could not load delivery history." />
      ) : !deliveries.data || deliveries.data.data.length === 0 ? (
        <p className="text-sm text-[var(--fg-secondary)]">No deliveries recorded yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-card)]">
          <table className="min-w-full text-xs">
            <thead>
              <tr className="border-b border-[var(--border-subtle)] bg-[var(--surface-sunken)]">
                <th className="px-3 py-2 text-left font-medium text-[var(--fg-tertiary)]">Event</th>
                <th className="px-3 py-2 text-left font-medium text-[var(--fg-tertiary)]">
                  Status
                </th>
                <th className="px-3 py-2 text-left font-medium text-[var(--fg-tertiary)]">
                  Duration
                </th>
                <th className="px-3 py-2 text-left font-medium text-[var(--fg-tertiary)]">
                  Attempt
                </th>
                <th className="px-3 py-2 text-left font-medium text-[var(--fg-tertiary)]">Time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-subtle)]">
              {deliveries.data.data.map((delivery) => (
                <DeliveryRow key={delivery.id} delivery={delivery} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function DeliveryRow({ delivery }: { delivery: WebhookDeliveryRecord }) {
  const [showError, setShowError] = useState(false);

  return (
    <>
      <tr
        className={cn(
          'transition-colors hover:bg-[var(--surface-sunken)]/60',
          !delivery.success && 'bg-[var(--error-surface)]/30',
        )}
      >
        <td className="px-3 py-2 font-mono text-[var(--fg-primary)]">{delivery.event}</td>
        <td className="px-3 py-2">
          <span
            className={cn(
              'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium',
              delivery.success
                ? 'bg-[var(--success-surface)] text-[var(--success-fg)]'
                : 'bg-[var(--error-surface)] text-[var(--error-fg)]',
            )}
          >
            <Icon name={delivery.success ? 'check' : 'x'} size={9} />
            {delivery.statusCode ?? 'timeout'}
          </span>
        </td>
        <td className="px-3 py-2 tabular-nums text-[var(--fg-secondary)]">
          {delivery.durationMs != null ? `${delivery.durationMs}ms` : '-'}
        </td>
        <td className="px-3 py-2 text-[var(--fg-secondary)]">#{delivery.attempt}</td>
        <td className="px-3 py-2 text-[var(--fg-tertiary)]">
          <div className="flex items-center gap-1">
            {relativeTime(delivery.createdAt)}
            {delivery.errorMessage ? (
              <button
                type="button"
                onClick={() => setShowError((value) => !value)}
                className="ml-1 inline-flex h-6 w-6 items-center justify-center rounded hover:bg-[var(--surface-sunken)] focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)]"
                aria-label={showError ? 'Hide error' : 'Show error'}
                aria-expanded={showError}
              >
                <Icon name="info" size={11} className="text-[var(--error-fg)]" />
              </button>
            ) : null}
          </div>
        </td>
      </tr>
      {showError && delivery.errorMessage ? (
        <tr>
          <td colSpan={5} className="px-3 pb-2 pt-0">
            <pre className="overflow-x-auto rounded-lg bg-[var(--surface-sunken)] px-3 py-2 text-[10px] text-[var(--error-fg)]">
              {delivery.errorMessage}
            </pre>
          </td>
        </tr>
      ) : null}
    </>
  );
}
