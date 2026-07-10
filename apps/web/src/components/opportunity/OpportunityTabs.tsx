import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/Tabs';
import { Card, SectionHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { EmptyState, ErrorState, LoadingSkeleton } from '@/components/ui/StateMessages';
import { SendForSignatureModal } from '@/components/signatures/SendForSignatureModal';
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
  // The Activity tab body — the page injects the timeline component
  // (pages/opportunityDetail/TimelinePanel) so this container stays dumb about
  // how the deal narrative is fetched and rendered.
  activityContent?: ReactNode;
}

export function OpportunityTabs({
  oppId,
  customer,
  intelDecisionUnit = [],
  documents = [],
  activityContent = null,
}: OpportunityTabsProps) {
  const { t } = useTranslation('crm');
  return (
    <Tabs defaultValue="decision-unit">
      <TabsList aria-label={t('opportunityTabs.sectionsAriaLabel', 'Opportunity sections')}>
        <TabsTrigger value="decision-unit">
          {t('opportunityTabs.tabDecisionUnit', 'Decision unit')}
        </TabsTrigger>
        <TabsTrigger value="contacts">{t('opportunityTabs.tabContacts', 'Contacts')}</TabsTrigger>
        <TabsTrigger value="tasks">{t('opportunityTabs.tabTasks', 'Tasks')}</TabsTrigger>
        <TabsTrigger value="documents">
          {t('opportunityTabs.tabDocuments', 'Documents')}
        </TabsTrigger>
        <TabsTrigger value="calls">{t('opportunityTabs.tabCalls', 'Calls')}</TabsTrigger>
        <TabsTrigger value="activity">{t('opportunityTabs.tabActivity', 'Activity')}</TabsTrigger>
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
      <TabsContent value="activity">{activityContent}</TabsContent>
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
  const { t } = useTranslation('crm');
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
        title={t('opportunityTabs.decisionUnitErrorTitle', "Couldn't load decision-unit contacts")}
        message={t('opportunityTabs.errorMessage', 'Please try again.')}
        action={
          <Button size="sm" variant="secondary" onClick={() => void contacts.refetch()}>
            {t('opportunityTabs.retry', 'Retry')}
          </Button>
        }
      />
    );
  if (rows.length === 0)
    return (
      <EmptyState
        title={t('opportunityTabs.decisionUnitEmptyTitle', 'No decision-unit members yet')}
        message={t(
          'opportunityTabs.decisionUnitEmptyMessage',
          'Add a contact from the Contacts page or sync from Dust.',
        )}
      />
    );

  return (
    <Card>
      <SectionHeader
        title={t('opportunityTabs.decisionUnitTitle', 'Decision unit')}
        caption={t('opportunityTabs.stakeholdersCount', '{{count}} stakeholders', {
          count: rows.length,
        })}
      />
      <ul className="divide-y divide-[var(--border-subtle)]">
        {rows.map((r) => (
          <li key={r.id} className="flex items-center justify-between gap-3 px-5 py-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <div className="text-sm font-medium text-[var(--fg-primary)]">{r.name}</div>
                {r.source === 'intel' ? (
                  <Badge tone="purple">{t('opportunityTabs.dustBadge', 'Dust')}</Badge>
                ) : null}
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
                aria-label={t(
                  'opportunityTabs.influenceAriaLabel',
                  'Influence {{value}} out of 5',
                  {
                    value: r.influence,
                  },
                )}
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
  const { t: translate } = useTranslation('crm');
  const all = useTasks();
  if (all.isLoading) return <LoadingSkeleton />;
  const tasks = all.data?.items.filter((t) => t.oppId === oppId) ?? [];
  if (tasks.length === 0)
    return (
      <EmptyState
        title={translate('opportunityTabs.tasksEmptyTitle', 'No tasks yet')}
        message={translate(
          'opportunityTabs.tasksEmptyMessage',
          'Create a follow-up to keep this bid moving.',
        )}
      />
    );
  return (
    <Card>
      <SectionHeader
        title={translate('opportunityTabs.tasksTitle', 'Tasks')}
        caption={translate('opportunityTabs.tasksActiveCount', '{{count}} active', {
          count: tasks.length,
        })}
      />
      <ul className="divide-y divide-[var(--border-subtle)]">
        {tasks.map((t: Task) => (
          <li key={t.id} className="flex items-center justify-between gap-3 px-5 py-3">
            <div>
              <div className="text-sm text-[var(--fg-primary)]">{t.title}</div>
              <div className="text-xs text-[var(--fg-tertiary)]">
                {translate('opportunityTabs.taskDue', 'Due {{date}}', {
                  date: formatDate(t.dueDate),
                })}
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
  const { t } = useTranslation('crm');
  const calls = useCalls({ entityType: 'OPPORTUNITY', entityId: oppId });
  if (calls.isLoading) return <LoadingSkeleton />;
  if (calls.isError)
    return (
      <ErrorState
        title={t('opportunityTabs.callsErrorTitle', "Couldn't load calls")}
        message={t('opportunityTabs.errorMessage', 'Please try again.')}
        action={
          <Button size="sm" variant="secondary" onClick={() => void calls.refetch()}>
            {t('opportunityTabs.retry', 'Retry')}
          </Button>
        }
      />
    );
  const items = calls.data?.pages.flatMap((p) => p.calls) ?? [];
  if (items.length === 0)
    return (
      <EmptyState
        title={t('opportunityTabs.callsEmptyTitle', 'No calls yet')}
        message={t(
          'opportunityTabs.callsEmptyMessage',
          'Scheduled and completed calls for this opportunity show up here.',
        )}
      />
    );
  return (
    <Card>
      <SectionHeader
        title={t('opportunityTabs.callsTitle', 'Calls')}
        caption={t('opportunityTabs.callsCount', '{{count}} call', {
          count: items.length,
        })}
      />
      <ul className="divide-y divide-[var(--border-subtle)]">
        {items.map((c) => {
          const when = c.startedAt
            ? formatDate(c.startedAt)
            : c.scheduledAt
              ? t('opportunityTabs.callScheduledAt', 'Scheduled {{date}}', {
                  date: formatDate(c.scheduledAt),
                })
              : '—';
          const mins = c.durationSec
            ? ` · ${t('opportunityTabs.callDurationMinutes', '{{count}} min', {
                count: Math.round(c.durationSec / 60),
              })}`
            : '';
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
  const { t } = useTranslation('crm');
  const [sendOpen, setSendOpen] = useState(false);
  const primaryDocumentId = documents[0]?.id;
  const hasDocument = documents.length > 0;
  // A signature request needs a Document id, not a DocumentTemplate id — with
  // no document uploaded there is nothing to send, so the trigger is disabled
  // rather than opening a modal that could only send a broken fallback id.
  const sendAction = hasDocument ? (
    <Button variant="secondary" size="sm" onClick={() => setSendOpen(true)}>
      <Icon name="mail" size={13} />
      {t('opportunityTabs.sendForSignatureButton', 'Send for Signature')}
    </Button>
  ) : (
    <Button
      variant="secondary"
      size="sm"
      disabled
      title={t(
        'opportunityTabs.sendForSignatureDisabledTitle',
        'Upload a document before sending it for signature',
      )}
    >
      <Icon name="mail" size={13} />
      {t('opportunityTabs.sendForSignatureButton', 'Send for Signature')}
    </Button>
  );

  if (!hasDocument)
    return (
      <EmptyState
        title={t('opportunityTabs.documentsEmptyTitle', 'No documents attached')}
        message={t(
          'opportunityTabs.documentsEmptyMessage',
          'Upload an RFP, SoW, or proposal draft.',
        )}
        action={sendAction}
      />
    );
  return (
    <>
      <Card>
        <SectionHeader
          title={t('opportunityTabs.documentsTitle', 'Documents')}
          caption={t('opportunityTabs.documentsCount', '{{count}} files', {
            count: documents.length,
          })}
          action={sendAction}
        />
        <ul className="divide-y divide-[var(--border-subtle)]">
          {documents.map((d) => (
            <li key={d.id} className="flex items-center justify-between gap-3 px-5 py-3">
              <div className="min-w-0">
                <div className="text-sm font-medium text-[var(--fg-primary)] truncate">
                  {d.name}
                </div>
                <div className="text-xs text-[var(--fg-tertiary)]">
                  {d.kind} ·{' '}
                  {d.bytes
                    ? `${(d.bytes / 1024).toFixed(1)} KB`
                    : t('opportunityTabs.documentUnknownSize', 'unknown size')}
                </div>
              </div>
              <Badge tone="gray">{d.kind}</Badge>
            </li>
          ))}
        </ul>
      </Card>
      <SendForSignatureModal
        open={sendOpen}
        onOpenChange={setSendOpen}
        documentId={primaryDocumentId}
      />
    </>
  );
}
