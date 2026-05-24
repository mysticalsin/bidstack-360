/**
 * DeliveryHistoryPanel — expandable panel showing recent delivery records
 * for a single webhook subscription.
 *
 * Fetches up to 50 most recent deliveries via useWebhookDeliveries.
 * Each row expands inline to reveal the error message when delivery failed.
 */

import { useState } from 'react';

import { Icon } from '@/components/ui/Icon';
import { ErrorState, LoadingSkeleton } from '@/components/ui/StateMessages';
import { useWebhookDeliveries, type WebhookDeliveryRecord } from '@/hooks/useWebhookSubscriptions';
import { cn } from '@/lib/cn';
import { relativeTime } from '@/lib/format';

// ── DeliveryHistoryPanel ───────────────────────────────────────────────────

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
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">
        Delivery history
      </h3>

      {deliveries.isLoading ? (
        <LoadingSkeleton rows={3} />
      ) : deliveries.isError ? (
        <ErrorState title="Failed to load" message="Could not load delivery history." />
      ) : !deliveries.data || deliveries.data.data.length === 0 ? (
        <p className="text-sm text-[var(--fg-secondary)]">No deliveries recorded yet.</p>
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-[var(--border-subtle)]">
            <table className="min-w-full text-xs">
              <thead>
                <tr className="border-b border-[var(--border-subtle)] bg-[var(--surface-card)]">
                  <th className="px-3 py-2 text-left font-medium text-[var(--fg-tertiary)]">Event</th>
                  <th className="px-3 py-2 text-left font-medium text-[var(--fg-tertiary)]">Status</th>
                  <th className="px-3 py-2 text-left font-medium text-[var(--fg-tertiary)]">Duration</th>
                  <th className="px-3 py-2 text-left font-medium text-[var(--fg-tertiary)]">Attempt</th>
                  <th className="px-3 py-2 text-left font-medium text-[var(--fg-tertiary)]">Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-subtle)]">
                {deliveries.data.data.map((d) => (
                  <DeliveryRow key={d.id} delivery={d} />
                ))}
              </tbody>
            </table>
          </div>
          {deliveries.data.hasMore && (
            <p className="mt-2 text-xs text-[var(--fg-tertiary)]">
              Showing 50 most recent deliveries.
            </p>
          )}
        </>
      )}
    </div>
  );
}

// ── DeliveryRow ────────────────────────────────────────────────────────────

function DeliveryRow({ delivery }: { delivery: WebhookDeliveryRecord }) {
  const [showError, setShowError] = useState(false);

  return (
    <>
      <tr
        className={cn(
          'transition-colors hover:bg-[var(--surface-card)]',
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
            {delivery.success ? (
              <Icon name="check" size={9} />
            ) : (
              <Icon name="x" size={9} />
            )}
            {delivery.statusCode ?? 'timeout'}
          </span>
        </td>
        <td className="px-3 py-2 tabular-nums text-[var(--fg-secondary)]">
          {delivery.durationMs != null ? `${delivery.durationMs}ms` : '—'}
        </td>
        <td className="px-3 py-2 text-[var(--fg-secondary)]">#{delivery.attempt}</td>
        <td className="px-3 py-2 text-[var(--fg-tertiary)]">
          <div className="flex items-center gap-1">
            {relativeTime(delivery.createdAt)}
            {delivery.errorMessage && (
              <button
                type="button"
                onClick={() => setShowError((v) => !v)}
                className="ml-1 inline-flex h-5 w-5 items-center justify-center rounded hover:bg-[var(--surface-sunken)] focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)]"
                aria-label={showError ? 'Hide error' : 'Show error'}
                aria-expanded={showError}
              >
                <Icon name="info" size={11} className="text-[var(--error-fg)]" />
              </button>
            )}
          </div>
        </td>
      </tr>
      {showError && delivery.errorMessage && (
        <tr>
          <td colSpan={5} className="px-3 pb-2 pt-0">
            <pre className="overflow-x-auto rounded bg-[var(--surface-sunken)] px-3 py-2 text-[10px] text-[var(--error-fg)]">
              {delivery.errorMessage}
            </pre>
          </td>
        </tr>
      )}
    </>
  );
}
