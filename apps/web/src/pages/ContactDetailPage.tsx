// /contacts/:id — contact detail with related opportunities, tasks, and notes.

import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/Button';
import { Card, SectionHeader } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { EmptyState, ErrorState } from '@/components/ui/StateMessages';
import { DetailPageSkeleton } from '@/components/skeletons/DetailPageSkeleton';
import { useContact } from '@/hooks/useContacts';
import { useOpportunities } from '@/hooks/useOpportunities';
import { useTasks } from '@/hooks/useTasks';
import { useNotes } from '@/hooks/useNotes';
import { EmailPanel } from '@/components/email/EmailPanel';
import { CustomFieldValuesSection } from '@/components/CustomFieldValuesSection';
import { CollaborativeNotesSection } from '@/components/editor/CollaborativeNotesSection';
import { formatDate } from '@/lib/format';

type RelatedQuery = {
  isLoading?: boolean;
  isPending?: boolean;
  isError?: boolean;
  data?: unknown;
};

// A first fetch has no payload. A later refetch keeps the last rows, so a
// loading flag with data already in hand is not "empty".
function relatedRead(query: RelatedQuery): 'loading' | 'error' | 'ready' {
  const hasData = query.data != null;
  if ((query.isLoading === true || query.isPending === true) && !hasData) return 'loading';
  if (query.isError === true && !hasData) return 'error';
  return 'ready';
}

// The notes API stores accountId lowercased. Comparing it to the display
// customer name hid every note the request had just returned.
function noteMatchesCustomer(accountId: string, customer: string): boolean {
  return accountId.trim().toLowerCase() === customer.trim().toLowerCase();
}

// role="status" takes its accessible name from the author (aria-label), not
// from the text inside it. The label and the visible sentence are the same
// words so a screen reader announces the line a sighted reader sees.
function StatusLine({ label }: { label: string }) {
  return (
    <p role="status" aria-label={label} className="p-5 text-sm text-[var(--fg-secondary)]">
      {label}
    </p>
  );
}

export function ContactDetailPage() {
  const { t } = useTranslation('crm');
  const { id } = useParams<{ id: string }>();
  const contact = useContact(id);
  // Server-side search narrows to this customer's deals; the exact-name filter
  // below drops substring matches such as "Globex Labs" for "Globex".
  const allOpps = useOpportunities({
    search: contact.data?.customer.slice(0, 100),
    limit: 200,
  });
  const allTasks = useTasks();
  const allNotes = useNotes(contact.data?.customer);

  if (contact.isLoading) return <DetailPageSkeleton columns={3} cards={3} />;
  if (contact.isError)
    return (
      <ErrorState
        title={t('contactDetail.errorTitle', "Couldn't load contact")}
        message={
          contact.error instanceof Error
            ? contact.error.message
            : t('contactDetail.errorMessage', 'The contact may have been deleted.')
        }
      />
    );
  if (!contact.data) {
    return (
      <EmptyState
        title={t('contactDetail.notFoundTitle', 'Contact not found')}
        message={t(
          'contactDetail.notFoundMessage',
          'The contact may have been deleted or you may not have access to it.',
        )}
        action={
          <Link to="/contacts" className="btn btn-secondary">
            {t('contactDetail.backToContacts', 'Back to contacts')}
          </Link>
        }
      />
    );
  }

  const c = contact.data;
  const oppRead = relatedRead(allOpps);
  const taskRead = relatedRead(allTasks);
  const noteRead = relatedRead(allNotes);
  const relatedOpps =
    oppRead === 'ready' ? (allOpps.data?.items.filter((o) => o.customer === c.customer) ?? []) : [];
  // A task is related only through its deal. Until that deal list has settled,
  // an empty task payload is not "no related tasks".
  const taskView =
    oppRead === 'loading' || taskRead === 'loading'
      ? 'loading'
      : oppRead === 'error'
        ? 'blocked'
        : taskRead === 'error'
          ? 'error'
          : 'ready';
  const relatedTasks =
    taskView === 'ready'
      ? (allTasks.data?.items.filter(
          (task) => task.oppId && relatedOpps.some((o) => o.id === task.oppId),
        ) ?? [])
      : [];
  const relatedNotes =
    noteRead === 'ready'
      ? (allNotes.data?.items.filter((n) => noteMatchesCustomer(n.accountId, c.customer)) ?? [])
      : [];
  const countCaption = (count: number) =>
    t('contactDetail.relatedCount', '{{count}} related', { count });

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <nav aria-label={t('contactDetail.breadcrumbLabel', 'Breadcrumb')}>
        <ol className="flex items-center gap-2 text-xs text-[var(--fg-tertiary)]">
          <li>
            <Link to="/contacts" className="hover:text-[var(--fg-primary)]">
              {t('contactDetail.contacts', 'Contacts')}
            </Link>
          </li>
          <li aria-hidden>/</li>
          <li aria-current="page" className="text-[var(--fg-primary)]">
            {c.name}
          </li>
        </ol>
      </nav>

      {/* Header card */}
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-4 p-5">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-[var(--fg-primary)]">{c.name}</h1>
            <p className="mt-1 text-sm text-[var(--fg-secondary)]">
              {c.role ?? t('contactDetail.noRole', 'No role')}
              {c.customer ? (
                <>
                  {' · '}
                  <Link
                    to={`/companies?search=${encodeURIComponent(c.customer)}`}
                    className="text-[var(--brand-primary)] dark:text-[var(--brand-deep)] hover:underline"
                  >
                    {c.customer}
                  </Link>
                </>
              ) : null}
            </p>
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-[var(--fg-secondary)]">
              {c.email ? (
                <span className="flex items-center gap-1.5">
                  <Icon name="mail" size={12} />
                  <a href={`mailto:${c.email}`} className="hover:text-[var(--brand-primary)]">
                    {c.email}
                  </a>
                </span>
              ) : null}
              {c.phone ? (
                <span className="flex items-center gap-1.5">
                  <Icon name="phone" size={12} />
                  <a href={`tel:${c.phone}`} className="hover:text-[var(--brand-primary)]">
                    {c.phone}
                  </a>
                </span>
              ) : null}
              {c.influence ? (
                <span>
                  {t('contactDetail.influence', 'Influence: {{value}}/5', { value: c.influence })}
                </span>
              ) : null}
              {c.sentiment ? (
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-semibold uppercase tracking-wider ${
                    c.sentiment === 'hot'
                      ? 'bg-[var(--danger-tint)] text-[var(--danger)]'
                      : c.sentiment === 'warm'
                        ? 'bg-[var(--warning-tint)] text-[var(--warning)]'
                        : c.sentiment === 'cold'
                          ? 'bg-[var(--info-tint)] text-[var(--info)]'
                          : 'bg-[var(--surface-subtle)] text-[var(--fg-secondary)]'
                  }`}
                >
                  {c.sentiment}
                </span>
              ) : null}
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs uppercase tracking-wider text-[var(--fg-tertiary)]">
              {t('contactDetail.added', 'Added')}
            </div>
            <div className="text-sm text-[var(--fg-primary)]">{formatDate(c.createdAt)}</div>
          </div>
        </div>
      </Card>

      {/* Related data grid */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Opportunities */}
        <Card>
          <SectionHeader
            title={t('contactDetail.opportunitiesTitle', 'Opportunities')}
            caption={
              oppRead === 'loading'
                ? t('contactDetail.relatedLoading', 'Loading')
                : oppRead === 'error'
                  ? t('contactDetail.relatedUnavailable', 'Unavailable')
                  : countCaption(relatedOpps.length)
            }
          />
          {oppRead === 'loading' ? (
            <StatusLine
              label={t(
                'contactDetail.opportunitiesLoading',
                'Loading opportunities for {{customer}}.',
                {
                  customer: c.customer,
                },
              )}
            />
          ) : oppRead === 'error' ? (
            <div role="alert" className="space-y-3 p-5">
              <p className="text-sm text-[var(--danger)]">
                {t(
                  'contactDetail.opportunitiesError',
                  'Could not load opportunities for {{customer}}.',
                  {
                    customer: c.customer,
                  },
                )}
              </p>
              <Button size="sm" variant="secondary" onClick={() => void allOpps.refetch()}>
                {t('contactDetail.retryOpportunities', 'Retry opportunities')}
              </Button>
            </div>
          ) : relatedOpps.length === 0 ? (
            <div className="p-5 text-sm text-[var(--fg-secondary)]">
              {t('contactDetail.noOpportunities', 'No opportunities for {{customer}}.', {
                customer: c.customer,
              })}
            </div>
          ) : (
            <ul className="divide-y divide-[var(--border-subtle)]">
              {relatedOpps.map((o) => (
                <li key={o.id} className="px-5 py-3">
                  <Link
                    to={`/opportunities/${o.id}`}
                    className="text-sm font-medium text-[var(--brand-primary)] dark:text-[var(--brand-deep)] hover:underline"
                  >
                    {o.code}
                  </Link>
                  <div className="text-xs text-[var(--fg-secondary)]">{o.name}</div>
                  <div className="mt-1 flex items-center gap-2 text-xs text-[var(--fg-tertiary)]">
                    <span className="rounded bg-[var(--surface-subtle)] px-1.5 py-0.5">
                      {o.stage}
                    </span>
                    <span>{o.probability}%</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Tasks */}
        <Card>
          <SectionHeader
            title={t('contactDetail.tasksTitle', 'Tasks')}
            caption={
              taskView === 'loading'
                ? t('contactDetail.relatedLoading', 'Loading')
                : taskView === 'ready'
                  ? countCaption(relatedTasks.length)
                  : t('contactDetail.relatedUnavailable', 'Unavailable')
            }
          />
          {taskView === 'loading' ? (
            <StatusLine label={t('contactDetail.tasksLoading', 'Loading related tasks.')} />
          ) : taskView === 'blocked' ? (
            <StatusLine
              label={t(
                'contactDetail.tasksBlocked',
                "Related tasks stay hidden until this contact's opportunities load.",
              )}
            />
          ) : taskView === 'error' ? (
            <div role="alert" className="space-y-3 p-5">
              <p className="text-sm text-[var(--danger)]">
                {t('contactDetail.tasksError', 'Could not load related tasks.')}
              </p>
              <Button size="sm" variant="secondary" onClick={() => void allTasks.refetch()}>
                {t('contactDetail.retryTasks', 'Retry tasks')}
              </Button>
            </div>
          ) : relatedTasks.length === 0 ? (
            <div className="p-5 text-sm text-[var(--fg-secondary)]">
              {t('contactDetail.noTasks', 'No related tasks.')}
            </div>
          ) : (
            <ul className="divide-y divide-[var(--border-subtle)]">
              {relatedTasks.map((task) => (
                <li key={task.id} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div>
                    <div className="text-sm text-[var(--fg-primary)]">{task.title}</div>
                    <div className="text-xs text-[var(--fg-tertiary)]">
                      {task.dueDate
                        ? t('contactDetail.dueDate', 'Due {{date}}', {
                            date: formatDate(task.dueDate),
                          })
                        : t('contactDetail.noDueDate', 'No due date')}
                      {task.assignee ? ` · ${task.assignee}` : null}
                    </div>
                  </div>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-semibold uppercase ${
                      task.status === 'done'
                        ? 'bg-[var(--success-tint)] text-[var(--success)]'
                        : task.status === 'in_progress'
                          ? 'bg-[var(--info-tint)] text-[var(--info)]'
                          : task.status === 'blocked'
                            ? 'bg-[var(--danger-tint)] text-[var(--danger)]'
                            : 'bg-[var(--surface-subtle)] text-[var(--fg-secondary)]'
                    }`}
                  >
                    {task.status.replace('_', ' ')}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Notes */}
        <Card>
          <SectionHeader
            title={t('contactDetail.notesTitle', 'Notes')}
            caption={
              noteRead === 'loading'
                ? t('contactDetail.relatedLoading', 'Loading')
                : noteRead === 'error'
                  ? t('contactDetail.relatedUnavailable', 'Unavailable')
                  : countCaption(relatedNotes.length)
            }
          />
          {noteRead === 'loading' ? (
            <StatusLine
              label={t('contactDetail.notesLoading', 'Loading notes for this account.')}
            />
          ) : noteRead === 'error' ? (
            <div role="alert" className="space-y-3 p-5">
              <p className="text-sm text-[var(--danger)]">
                {t('contactDetail.notesError', 'Could not load notes for this account.')}
              </p>
              <Button size="sm" variant="secondary" onClick={() => void allNotes.refetch()}>
                {t('contactDetail.retryNotes', 'Retry notes')}
              </Button>
            </div>
          ) : relatedNotes.length === 0 ? (
            <div className="p-5 text-sm text-[var(--fg-secondary)]">
              {t('contactDetail.noNotes', 'No notes for this account.')}
            </div>
          ) : (
            <ul className="divide-y divide-[var(--border-subtle)]">
              {relatedNotes.map((n) => (
                <li key={n.id} className="px-5 py-3">
                  <div className="text-sm font-medium text-[var(--fg-primary)]">{n.title}</div>
                  <div className="text-xs text-[var(--fg-tertiary)]">
                    {n.authorEmail ?? t('contactDetail.unknownAuthor', 'Unknown')} ·{' '}
                    {formatDate(n.createdAt)}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <EmailPanel filter={{ contactId: c.id }} defaultTo={c.email ?? undefined} />
      <CustomFieldValuesSection entityType="contact" entityId={id!} />

      {/* Wave 8 — Collaborative scratch-pad: real-time CRDT rich-text. */}
      <CollaborativeNotesSection
        entityType="contact"
        entityId={id}
        fieldKey="notes"
        label={t('contactDetail.liveCollaboration', 'Live collaboration')}
      />
    </div>
  );
}
