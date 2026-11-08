import { CalendarDays, Mail, MessageSquare, MessagesSquare, Video } from 'lucide-react';
import { useId, useState } from 'react';

import type { AccountConversation } from '@bidstack/shared';

import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { LoadingSkeleton } from '@/components/ui/StateMessages';
import { useAccountConversations, useRefileMeeting } from '@/hooks/useAccountConversations';
import { useHasPermission } from '@/hooks/useCapabilities';

import { OpenInTeamsLink, TeamsImportSheet } from './TeamsImportSheet';

const COMPANY_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACCOUNT_ONLY = '';

const SOURCE_TONE: Record<string, BadgeTone> = {
  teams: 'purple',
  outlook: 'blue',
  gmail: 'rose',
  google_calendar: 'teal',
};

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

function RowIcon({ item }: { item: AccountConversation }) {
  const Glyph =
    item.type === 'teams_message'
      ? MessageSquare
      : item.type === 'email'
        ? Mail
        : item.channel === 'teams'
          ? Video
          : CalendarDays;
  return (
    <span aria-hidden="true" className="mt-0.5 shrink-0 text-[var(--fg-tertiary)]">
      <Glyph size={16} />
    </span>
  );
}

function RefileSelect({
  item,
  companyId,
  options,
}: {
  item: AccountConversation;
  companyId: string;
  options: Array<{ id: string; name: string }>;
}) {
  const id = useId();
  const refile = useRefileMeeting(companyId);
  if (!item.canRefile || item.sourceRecord?.kind !== 'calendar_event') return null;
  const calendarEventId = item.sourceRecord.id;
  return (
    <span className="inline-flex items-center gap-1.5">
      <label htmlFor={id} className="sr-only">
        File to opportunity
      </label>
      <select
        id={id}
        className="max-w-[12rem] truncate rounded-md border border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-1.5 py-0.5 text-xs text-[var(--fg-primary)] pointer-coarse:min-h-11 pointer-coarse:min-w-11 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)]"
        value={item.opportunity?.id ?? ACCOUNT_ONLY}
        disabled={refile.isPending}
        onChange={(e) =>
          refile.mutate({ calendarEventId, opportunityId: e.target.value === ACCOUNT_ONLY ? null : e.target.value })
        }
      >
        <option value={ACCOUNT_ONLY}>Account only</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
        {item.opportunity && !options.some((o) => o.id === item.opportunity?.id) && (
          <option value={item.opportunity.id}>{item.opportunity.name}</option>
        )}
      </select>
      {refile.isError && (
        <span role="alert" className="text-xs text-[var(--fg-secondary)]">
          Not saved. Try again.
        </span>
      )}
    </span>
  );
}

function Row({
  item,
  companyId,
  options,
}: {
  item: AccountConversation;
  companyId: string;
  options: Array<{ id: string; name: string }>;
}) {
  const cancelled = item.status === 'cancelled';
  const facts = [
    when(item.occurredAt),
    ...(item.author ? [item.author] : []),
    `${item.participantCount} ${item.participantCount === 1 ? 'person' : 'people'}`,
    ...(item.direction ? [item.direction === 'inbound' ? 'Received' : 'Sent'] : []),
  ];
  return (
    <li className="flex items-start gap-3 py-3">
      <RowIcon item={item} />
      <div className="min-w-0 flex-1">
        <p
          className={`truncate text-sm font-medium text-[var(--fg-primary)] ${cancelled ? 'line-through' : ''}`}
          title={item.subject}
        >
          {item.subject}
        </p>
        <p className="truncate text-xs tabular-nums text-[var(--fg-secondary)]">{facts.join(' · ')}</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <Badge tone={item.source ? (SOURCE_TONE[item.source] ?? 'gray') : 'gray'} data-testid="conversation-source">
            {item.sourceLabel}
          </Badge>
          {item.filing && (
            <span className="text-xs text-[var(--fg-tertiary)]">
              {item.filing === 'manual' ? 'Filed by you' : 'Filed automatically'}
            </span>
          )}
          {cancelled && <Badge tone="gray">Cancelled</Badge>}
          {item.needsOpportunity && <Badge tone="amber">Needs opportunity</Badge>}
          {item.opportunity && !item.canRefile && (
            <span className="max-w-[14rem] truncate text-xs text-[var(--fg-secondary)]" title={item.opportunity.name}>
              {item.opportunity.name}
            </span>
          )}
          <RefileSelect item={item} companyId={companyId} options={options} />
          {item.type === 'teams_message' && item.webUrl && <OpenInTeamsLink href={item.webUrl} />}
        </div>
      </div>
    </li>
  );
}

/**
 * Meetings and emails on the account, newest first. Synced rows come from the
 * connected Outlook and Google calendars and mailboxes; the chip on each row
 * names the source.
 */
export function AccountConversations({ companyId, companyName }: { companyId: string; companyName?: string }) {
  const canRead = useHasPermission('activities:read');
  const canWrite = useHasPermission('activities:write');
  const [teamsOpen, setTeamsOpen] = useState(false);
  const eligible = canRead && COMPANY_ID_RE.test(companyId);
  const { data, isLoading, isError, refetch, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useAccountConversations(eligible ? companyId : undefined);

  if (!eligible) return null;

  const items = data?.pages.flatMap((p) => p.items) ?? [];
  const options = data?.pages[0]?.openOpportunities ?? [];

  return (
    <Card>
      <div className="flex items-center gap-2 border-b border-[var(--border-subtle)] p-4">
        <span aria-hidden="true" className="text-[var(--fg-tertiary)]">
          <MessagesSquare size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold text-[var(--fg-primary)]">Conversations</h2>
          <p className="truncate text-xs text-[var(--fg-tertiary)]">
            From your connected Outlook and Google calendars and mailboxes
          </p>
        </div>
        {canWrite && (
          <Button variant="secondary" size="sm" className="shrink-0" onClick={() => setTeamsOpen(true)}>
            Import from Teams
          </Button>
        )}
      </div>
      {canWrite && teamsOpen && (
        <TeamsImportSheet
          companyId={companyId}
          companyName={companyName ?? 'this account'}
          open={teamsOpen}
          onOpenChange={setTeamsOpen}
        />
      )}
      <div className="px-4">
        {isLoading ? (
          <div className="py-4">
            <LoadingSkeleton rows={3} />
          </div>
        ) : isError || !data ? (
          <div role="alert" className="flex items-center justify-between gap-3 py-4 text-sm">
            <span className="text-[var(--fg-secondary)]">Conversations did not load.</span>
            <Button variant="secondary" size="sm" onClick={() => void refetch()}>
              Retry
            </Button>
          </div>
        ) : items.length === 0 ? (
          <p className="py-4 text-sm text-[var(--fg-secondary)]">No synced meetings or emails yet.</p>
        ) : (
          <>
            <ul className="divide-y divide-[var(--border-subtle)]">
              {items.map((item) => (
                <Row key={item.id} item={item} companyId={companyId} options={options} />
              ))}
            </ul>
            {hasNextPage && (
              <div className="py-3">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={isFetchingNextPage}
                  onClick={() => void fetchNextPage()}
                >
                  Show more
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </Card>
  );
}
