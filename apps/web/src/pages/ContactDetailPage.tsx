// /contacts/:id — contact detail with related opportunities, tasks, and notes.

import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { Card, SectionHeader } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { EmptyState, ErrorState } from '@/components/ui/StateMessages';
import { DetailPageSkeleton } from '@/components/skeletons/DetailPageSkeleton';
import { useContact } from '@/hooks/useContacts';
import { useOpportunities } from '@/hooks/useOpportunities';
import { useTasks } from '@/hooks/useTasks';
import { useNotes } from '@/hooks/useNotes';
import { CustomFieldValuesSection } from '@/components/CustomFieldValuesSection';
import { CollaborativeNotesSection } from '@/components/editor/CollaborativeNotesSection';
import { formatDate } from '@/lib/format';

export function ContactDetailPage() {
  const { t } = useTranslation('crm');
  const { id } = useParams<{ id: string }>();
  const contact = useContact(id);
  const allOpps = useOpportunities({ limit: 100 });
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
  const relatedOpps = allOpps.data?.items.filter((o) => o.customer === c.customer) ?? [];
  const relatedTasks =
    allTasks.data?.items.filter((t) => t.oppId && relatedOpps.some((o) => o.id === t.oppId)) ?? [];
  const relatedNotes = allNotes.data?.items.filter((n) => n.accountId === c.customer) ?? [];

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
                    className="text-[var(--brand-primary)] hover:underline"
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
                  className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
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
            <div className="text-[11px] uppercase tracking-wider text-[var(--fg-tertiary)]">
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
            caption={t('contactDetail.relatedCount', '{{count}} related', {
              count: relatedOpps.length,
            })}
          />
          {relatedOpps.length === 0 ? (
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
                    className="text-sm font-medium text-[var(--brand-primary)] hover:underline"
                  >
                    {o.code}
                  </Link>
                  <div className="text-xs text-[var(--fg-secondary)]">{o.name}</div>
                  <div className="mt-1 flex items-center gap-2 text-[11px] text-[var(--fg-tertiary)]">
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
            caption={t('contactDetail.relatedCount', '{{count}} related', {
              count: relatedTasks.length,
            })}
          />
          {relatedTasks.length === 0 ? (
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
                    className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${
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
            caption={t('contactDetail.relatedCount', '{{count}} related', {
              count: relatedNotes.length,
            })}
          />
          {relatedNotes.length === 0 ? (
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
