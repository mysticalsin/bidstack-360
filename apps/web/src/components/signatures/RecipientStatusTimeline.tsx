/**
 * Vertical timeline showing each recipient's event chain.
 *
 * WHY: Each recipient's events need to be grouped and colour-coded so ops
 * staff can see at a glance who has signed vs who is blocking completion.
 * A plain table loses the temporal ordering that makes the story clear.
 */

import { cn } from '@/lib/cn';
import type { SignatureEvent, SignatureEventType, SignatureRecipient } from '@bidstack/shared';
import { format } from 'date-fns';

// ─── Event colour mapping ─────────────────────────────────────────────────────

const EVENT_COLOR: Record<SignatureEventType, string> = {
  SENT: 'bg-[var(--tag-blue-bg)] text-[var(--tag-blue-fg)] border-[var(--tag-blue-fg)]',
  DELIVERED: 'bg-[var(--tag-teal-bg)] text-[var(--tag-teal-fg)] border-[var(--tag-teal-fg)]',
  VIEWED: 'bg-[var(--tag-purple-bg)] text-[var(--tag-purple-fg)] border-[var(--tag-purple-fg)]',
  SIGNED: 'bg-[var(--tag-jade-bg)] text-[var(--tag-jade-fg)] border-[var(--tag-jade-fg)]',
  DECLINED: 'bg-[var(--tag-tomato-bg)] text-[var(--tag-tomato-fg)] border-[var(--tag-tomato-fg)]',
  VOIDED: 'bg-[var(--tag-amber-bg)] text-[var(--tag-amber-fg)] border-[var(--tag-amber-fg)]',
};

const EVENT_LABEL: Record<SignatureEventType, string> = {
  SENT: 'Sent',
  DELIVERED: 'Delivered',
  VIEWED: 'Opened',
  SIGNED: 'Signed',
  DECLINED: 'Declined',
  VOIDED: 'Voided',
};

// ─── Dot indicator ───────────────────────────────────────────────────────────

function EventDot({ type }: { type: SignatureEventType }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-block h-2.5 w-2.5 shrink-0 rounded-full border',
        EVENT_COLOR[type],
      )}
    />
  );
}

// ─── Single event row ─────────────────────────────────────────────────────────

function EventRow({ event }: { event: SignatureEvent }) {
  return (
    <li className="flex items-start gap-3 py-2">
      <div className="flex flex-col items-center gap-1 pt-0.5">
        <EventDot type={event.type} />
        {/* connector line — hidden on last item via CSS group trick */}
        <span
          aria-hidden="true"
          className="w-px flex-1 bg-[var(--border-subtle)] group-last:hidden"
        />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-[var(--fg-primary)]">
          {EVENT_LABEL[event.type]}
          {event.recipientEmail ? (
            <span className="ml-1 font-normal text-[var(--fg-secondary)]">
              — {event.recipientEmail}
            </span>
          ) : null}
        </p>
        <time
          dateTime={event.occurredAt}
          className="block text-xs text-[var(--fg-tertiary)]"
        >
          {format(new Date(event.occurredAt), 'PPp')}
        </time>
      </div>
    </li>
  );
}

// ─── Recipient block ──────────────────────────────────────────────────────────

function RecipientBlock({
  recipient,
  events,
}: {
  recipient: SignatureRecipient;
  events: SignatureEvent[];
}) {
  return (
    <section aria-label={`Events for ${recipient.name}`} className="mb-6 last:mb-0">
      <header className="mb-2 flex items-center gap-2">
        <div
          aria-hidden="true"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--surface-sunken)] text-xs font-semibold text-[var(--fg-primary)] uppercase"
        >
          {recipient.name.charAt(0)}
        </div>
        <div>
          <p className="text-sm font-semibold text-[var(--fg-primary)]">{recipient.name}</p>
          <p className="text-xs text-[var(--fg-secondary)]">
            {recipient.email} · {recipient.role}
          </p>
        </div>
      </header>

      {events.length === 0 ? (
        <p className="ml-9 text-xs text-[var(--fg-tertiary)]">No events yet</p>
      ) : (
        <ol className="ml-9 list-none" role="list">
          {events.map((e) => (
            <li key={e.id} className="group">
              <EventRow event={e} />
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

// ─── Public API ───────────────────────────────────────────────────────────────

interface RecipientStatusTimelineProps {
  recipients: SignatureRecipient[];
  events: SignatureEvent[];
  className?: string;
}

export function RecipientStatusTimeline({
  recipients,
  events,
  className,
}: RecipientStatusTimelineProps) {
  // Group events by recipientEmail for per-person rendering
  const eventsByEmail = events.reduce<Record<string, SignatureEvent[]>>((acc, ev) => {
    const key = ev.recipientEmail ?? '__global__';
    acc[key] = acc[key] ?? [];
    acc[key].push(ev);
    return acc;
  }, {});

  return (
    <div className={cn('rounded-xl border border-[var(--border-subtle)] p-4', className)}>
      {recipients.map((r) => (
        <RecipientBlock
          key={r.email}
          recipient={r}
          events={eventsByEmail[r.email] ?? []}
        />
      ))}
    </div>
  );
}
