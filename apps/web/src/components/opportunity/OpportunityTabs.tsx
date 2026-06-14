import { useQuery } from '@tanstack/react-query';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/Tabs';
import { Card, SectionHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState, ErrorState, LoadingSkeleton } from '@/components/ui/StateMessages';
import { useTasks } from '@/hooks/useTasks';
import { useCalls } from '@/hooks/useCalls';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import type { Contact, Task } from '@bidstack/shared';

import { ContactsPanel } from './opportunityTabs/ContactsPanel';

// Call status → Badge tone. Calls live in this tab now rather than a standalone
// rail page, so they're read in the context of the bid they belong to.
const CALL_TONE: Record<string, 'jade' | 'blue' | 'gray' | 'tomato'> = {
  COMPLETED: 'jade',
  LIVE: 'blue',
  SCHEDULED: 'gray',
  FAILED: 'tomato',
  CANCELLED: 'gray',
};

interface OpportunityTabsProps {
  oppId: string;
  customer: string;
  intelDecisionUnit?: Array<{
    contactId: string;
    name: string;
    role: string;
    influence: number;
    sentiment: 'hot' | 'warm' | 'neutral' | 'cold';
    power: 'decision' | 'champion' | 'influencer' | 'gatekeeper' | 'approver';
  }>;
  documents?: Array<{ id: string; name: string; kind: string; bytes: number | null }>;
  timeline?: Array<{ at: string; kind: string; text: string }>;
}

export function OpportunityTabs({
  oppId,
  customer,
  intelDecisionUnit = [],
  documents = [],
  timeline = [],
}: OpportunityTabsProps) {
  return (
    <Tabs defaultValue="decision-unit">
      <TabsList aria-label="Opportunity sections">
        <TabsTrigger value="decision-unit">Decision unit</TabsTrigger>
        <TabsTrigger value="contacts">Contacts</TabsTrigger>
        <TabsTrigger value="tasks">Tasks</TabsTrigger>
        <TabsTrigger value="documents">Documents</TabsTrigger>
        <TabsTrigger value="calls">Calls</TabsTrigger>
        <TabsTrigger value="activity">Activity</TabsTrigger>
      </TabsList>

      <TabsContent value="decision-unit">
        <DecisionUnitPanel customer={customer} intelDecisionUnit={intelDecisionUnit} />
      </TabsContent>
      <TabsContent value="contacts">
        <ContactsPanel oppId={oppId} />
      </TabsContent>
      <TabsContent value="tasks">
        <TasksPanel oppId={oppId} />
      </TabsContent>
      <TabsContent value="documents">
        <DocumentsPanel documents={documents} />
      </TabsContent>
      <TabsContent value="calls">
        <CallsPanel oppId={oppId} />
      </TabsContent>
      <TabsContent value="activity">
        <ActivityPanel timeline={timeline} />
      </TabsContent>
    </Tabs>
  );
}

// Pulls /api/contacts?customer=X. Falls back to intel.decisionUnit when the
// contacts table doesn't have a row for this customer yet (Dust-only data).
function DecisionUnitPanel({
  customer,
  intelDecisionUnit,
}: {
  customer: string;
  intelDecisionUnit: NonNullable<OpportunityTabsProps['intelDecisionUnit']>;
}) {
  const contacts = useQuery({
    queryKey: ['contacts', customer],
    queryFn: ({ signal }) =>
      api<{ items: Contact[] }>(`/api/contacts?customer=${encodeURIComponent(customer)}&limit=50`, {
        signal,
      }),
  });

  type Row = {
    id: string;
    name: string;
    role: string;
    sentiment: 'hot' | 'warm' | 'neutral' | 'cold';
    influence: number;
    email: string | null;
    phone: string | null;
    source: 'crm' | 'intel';
  };

  const rows: Row[] =
    contacts.data?.items.map<Row>((c) => ({
      id: c.id,
      name: c.name,
      role: c.role ?? '—',
      sentiment: c.sentiment ?? 'neutral',
      influence: c.influence ?? 0,
      email: c.email,
      phone: c.phone,
      source: 'crm',
    })) ?? [];

  // Augment with intel-only members (no CRM record for them yet)
  const known = new Set(rows.map((r) => r.name));
  for (const m of intelDecisionUnit) {
    if (!known.has(m.name)) {
      rows.push({
        id: m.contactId,
        name: m.name,
        role: m.role,
        sentiment: m.sentiment,
        influence: Math.round(m.influence * 5),
        email: null,
        phone: null,
        source: 'intel',
      });
    }
  }

  if (contacts.isLoading) return <LoadingSkeleton />;
  // Surface a fetch failure instead of silently showing the "no members" empty
  // state (which misreads a CRM outage as "nothing here yet").
  if (contacts.isError)
    return (
      <ErrorState
        title="Couldn't load decision-unit contacts"
        message="Please try again."
        action={
          <Button size="sm" variant="secondary" onClick={() => void contacts.refetch()}>
            Retry
          </Button>
        }
      />
    );
  if (rows.length === 0)
    return (
      <EmptyState
        title="No decision-unit members yet"
        message="Add a contact from the Contacts page or sync from Dust."
      />
    );

  return (
    <Card>
      <SectionHeader title="Decision unit" caption={`${rows.length} stakeholders`} />
      <ul className="divide-y divide-[var(--border-subtle)]">
        {rows.map((r) => (
          <li key={r.id} className="flex items-center justify-between gap-3 px-5 py-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <div className="text-sm font-medium text-[var(--fg-primary)]">{r.name}</div>
                {r.source === 'intel' ? <Badge tone="purple">Dust</Badge> : null}
              </div>
              <div className="text-xs text-[var(--fg-tertiary)]">{r.role}</div>
              {r.email ? (
                <div className="text-[10px] font-mono text-[var(--fg-tertiary)] mt-0.5">
                  {r.email}
                </div>
              ) : null}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Badge
                tone={
                  r.sentiment === 'hot'
                    ? 'tomato'
                    : r.sentiment === 'warm'
                      ? 'amber'
                      : r.sentiment === 'cold'
                        ? 'blue'
                        : 'gray'
                }
              >
                {r.sentiment}
              </Badge>
              <div
                className="text-xs font-semibold tabular-nums text-[var(--fg-primary)]"
                aria-label={`Influence ${r.influence} out of 5`}
              >
                {r.influence}/5
              </div>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function TasksPanel({ oppId }: { oppId: string }) {
  const all = useTasks();
  if (all.isLoading) return <LoadingSkeleton />;
  const tasks = all.data?.items.filter((t) => t.oppId === oppId) ?? [];
  if (tasks.length === 0)
    return (
      <EmptyState title="No tasks yet" message="Create a follow-up to keep this bid moving." />
    );
  return (
    <Card>
      <SectionHeader title="Tasks" caption={`${tasks.length} active`} />
      <ul className="divide-y divide-[var(--border-subtle)]">
        {tasks.map((t: Task) => (
          <li key={t.id} className="flex items-center justify-between gap-3 px-5 py-3">
            <div>
              <div className="text-sm text-[var(--fg-primary)]">{t.title}</div>
              <div className="text-xs text-[var(--fg-tertiary)]">
                Due {formatDate(t.dueDate)}
                {t.assignee ? <> · {t.assignee}</> : null}
              </div>
            </div>
            <Badge
              tone={
                t.status === 'done'
                  ? 'jade'
                  : t.status === 'in_progress'
                    ? 'blue'
                    : t.status === 'blocked'
                      ? 'tomato'
                      : 'gray'
              }
            >
              {t.status.replace('_', ' ')}
            </Badge>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function CallsPanel({ oppId }: { oppId: string }) {
  const calls = useCalls({ entityType: 'OPPORTUNITY', entityId: oppId });
  if (calls.isLoading) return <LoadingSkeleton />;
  if (calls.isError)
    return (
      <ErrorState
        title="Couldn't load calls"
        message="Please try again."
        action={
          <Button size="sm" variant="secondary" onClick={() => void calls.refetch()}>
            Retry
          </Button>
        }
      />
    );
  const items = calls.data?.pages.flatMap((p) => p.calls) ?? [];
  if (items.length === 0)
    return (
      <EmptyState
        title="No calls yet"
        message="Scheduled and completed calls for this opportunity show up here."
      />
    );
  return (
    <Card>
      <SectionHeader title="Calls" caption={`${items.length} call${items.length === 1 ? '' : 's'}`} />
      <ul className="divide-y divide-[var(--border-subtle)]">
        {items.map((c) => {
          const when = c.startedAt
            ? formatDate(c.startedAt)
            : c.scheduledAt
              ? `Scheduled ${formatDate(c.scheduledAt)}`
              : '—';
          const mins = c.durationSec ? ` · ${Math.round(c.durationSec / 60)} min` : '';
          return (
            <li key={c.id} className="flex items-center justify-between gap-3 px-5 py-3">
              <div className="min-w-0">
                <div className="text-sm font-medium text-[var(--fg-primary)]">
                  {c.provider.replace(/_/g, ' ')}
                </div>
                <div className="text-xs text-[var(--fg-tertiary)]">
                  {when}
                  {mins}
                </div>
                {c.summary ? (
                  <div className="mt-0.5 line-clamp-2 text-xs text-[var(--fg-secondary)]">
                    {c.summary}
                  </div>
                ) : null}
              </div>
              <Badge tone={CALL_TONE[c.status] ?? 'gray'}>{c.status.toLowerCase()}</Badge>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function DocumentsPanel({
  documents,
}: {
  documents: NonNullable<OpportunityTabsProps['documents']>;
}) {
  if (documents.length === 0)
    return (
      <EmptyState title="No documents attached" message="Upload an RFP, SoW, or proposal draft." />
    );
  return (
    <Card>
      <SectionHeader title="Documents" caption={`${documents.length} files`} />
      <ul className="divide-y divide-[var(--border-subtle)]">
        {documents.map((d) => (
          <li key={d.id} className="flex items-center justify-between gap-3 px-5 py-3">
            <div className="min-w-0">
              <div className="text-sm font-medium text-[var(--fg-primary)] truncate">{d.name}</div>
              <div className="text-xs text-[var(--fg-tertiary)]">
                {d.kind} · {d.bytes ? `${(d.bytes / 1024).toFixed(1)} KB` : 'unknown size'}
              </div>
            </div>
            <Badge tone="gray">{d.kind}</Badge>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function ActivityPanel({ timeline }: { timeline: NonNullable<OpportunityTabsProps['timeline']> }) {
  if (timeline.length === 0)
    return (
      <EmptyState
        title="No activity yet"
        message="Stage moves, Dust webhooks, and notes will appear here."
      />
    );
  return (
    <Card>
      <SectionHeader title="Activity" />
      <ol className="px-5 py-4 space-y-3">
        {timeline.map((e, i) => (
          <li key={i} className="flex items-start gap-3">
            <div
              className="mt-1.5 h-2 w-2 rounded-full bg-[var(--brand-primary)] shrink-0"
              aria-hidden
            />
            <div className="min-w-0">
              <div className="text-sm text-[var(--fg-primary)]">{e.text}</div>
              <div className="text-xs text-[var(--fg-tertiary)]">
                {e.kind} · {formatDate(e.at)}
              </div>
            </div>
          </li>
        ))}
      </ol>
    </Card>
  );
}
