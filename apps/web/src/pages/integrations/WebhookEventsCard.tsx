/**
 * integrations/WebhookEventsCard.tsx — recent webhook events table for the
 * Integrations overview tab.
 *
 * WHY a separate module: WebhookEventsCard is ~100 lines and only depends on
 * WebhookEvent (a type) and webhookStatusTone (a pure helper). Extracting it
 * keeps the overview tab clean and makes the table independently reusable.
 */
import { Badge } from '@/components/ui/Badge';
import { Card, SectionHeader } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { LoadingSkeleton } from '@/components/ui/StateMessages';
import { relativeTime } from '@/lib/format';

import { webhookStatusTone } from './integration-helpers';
import type { WebhookEvent } from './types';

export function WebhookEventsCard({
  events,
  isLoading,
}: {
  events: WebhookEvent[];
  isLoading: boolean;
}) {
  const errorCount = events.filter((event) => event.status === 'error').length;

  return (
    <Card className="overflow-hidden border-[var(--border-subtle)] bg-[var(--surface-primary)]">
      <SectionHeader
        title="Recent webhook events"
        caption="A live evidence stream for Dust callbacks, CRM event subscribers and external automations."
        action={
          <Badge tone={errorCount > 0 ? 'tomato' : events.length > 0 ? 'jade' : 'gray'}>
            {errorCount > 0 ? `${errorCount} errors` : events.length > 0 ? 'processing' : 'quiet'}
          </Badge>
        }
      />
      {isLoading ? (
        <div className="p-5">
          <LoadingSkeleton rows={4} />
        </div>
      ) : events.length === 0 ? (
        <div className="grid min-h-[220px] place-items-center px-6 py-10 text-center">
          <div className="max-w-sm">
            <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-[var(--surface-secondary)] text-[var(--text-secondary)]">
              <Icon name="bell" className="size-5" />
            </span>
            <h3 className="mt-4 text-lg font-semibold text-[var(--text-primary)]">
              No webhook events yet
            </h3>
            <p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">
              Once Dust or another system calls back, events appear here with status, source and
              timing.
            </p>
          </div>
        </div>
      ) : (
        <div
          className="overflow-x-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)]"
          role="region"
          aria-label="Recent webhook events table"
          tabIndex={0}
        >
          <table className="w-full min-w-[760px] border-collapse text-left text-sm">
            <caption className="sr-only">Recent webhook events, newest first</caption>
            <thead className="bg-[var(--surface-secondary)] text-xs uppercase tracking-[0.14em] text-[var(--text-muted)]">
              <tr>
                <th scope="col" className="px-5 py-3 font-semibold">
                  Event
                </th>
                <th scope="col" className="px-5 py-3 font-semibold">
                  Source
                </th>
                <th scope="col" className="px-5 py-3 font-semibold">
                  Received
                </th>
                <th scope="col" className="px-5 py-3 text-right font-semibold">
                  Status
                </th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr
                  key={event.id}
                  className="border-b border-[var(--border-subtle)] align-top transition hover:bg-[var(--surface-secondary)]/70"
                >
                  <td className="px-5 py-4">
                    <div className="font-mono text-xs text-[var(--text-primary)]">
                      {event.eventType}
                    </div>
                    {event.error ? (
                      <p className="mt-1 text-xs text-[var(--danger)]">{event.error}</p>
                    ) : (
                      <p className="mt-1 text-xs text-[var(--text-muted)]">
                        Event accepted by the integration receiver.
                      </p>
                    )}
                  </td>
                  <td className="px-5 py-4">
                    <Badge tone={event.source === 'dust.webhook' ? 'purple' : 'gray'}>
                      {event.source}
                    </Badge>
                  </td>
                  <td className="px-5 py-4 text-xs tabular-nums text-[var(--text-secondary)]">
                    {relativeTime(event.receivedAt)}
                  </td>
                  <td className="px-5 py-4 text-right">
                    <Badge tone={webhookStatusTone(event.status)}>{event.status}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
