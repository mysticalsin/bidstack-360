import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { EmptyState, ErrorState, LoadingSkeleton } from '@/components/ui/StateMessages';
import { useServiceCase, useUpdateServiceCase } from '@/hooks/useServiceCases';
import { toast } from '@/components/ui/Toast';
import { useHasPermission } from '@/hooks/useCapabilities';

// Transition map keyed by the canonical CaseStatus enum (packages/shared
// service-desk.ts: new | open | waiting_customer | waiting_internal |
// resolved | closed | escalated). The earlier map referenced a non-existent
// `pending` status, so cases sitting in waiting_customer / waiting_internal /
// escalated rendered NO action buttons, and any button that did show emitted
// an invalid status the API would reject.
const STATUS_FLOW: Record<string, string[]> = {
  new: ['open', 'escalated'],
  open: ['waiting_customer', 'waiting_internal', 'escalated', 'resolved'],
  waiting_customer: ['open', 'resolved'],
  waiting_internal: ['open', 'resolved'],
  escalated: ['open', 'resolved'],
  resolved: ['closed', 'open'],
  closed: ['open'],
};

export function ServiceCaseDetailPage() {
  const { t } = useTranslation('crm');
  const { id } = useParams<{ id: string }>();
  const c = useServiceCase(id);
  const update = useUpdateServiceCase();
  const [note, setNote] = useState('');
  // Status transitions and note-saving PATCH through service-cases routes,
  // gated server-side behind service-desk:write — disable rather than hide so
  // a read-only agent still sees the case's status flow (avoids 403-on-click).
  const canWrite = useHasPermission('service-desk:write');
  const readOnlyHint = t(
    'serviceCaseDetail.readOnlyHint',
    'You need service desk write access to update this case.',
  );

  if (c.isLoading) return <LoadingSkeleton rows={6} />;
  if (c.isError)
    return (
      <ErrorState
        title={t('serviceCaseDetail.errorTitle', 'Failed to load case')}
        message={
          c.error instanceof Error
            ? c.error.message
            : t('serviceCaseDetail.errorMessage', 'Something went wrong')
        }
      />
    );
  if (!c.data)
    return (
      <EmptyState
        title={t('serviceCaseDetail.notFoundTitle', 'Case not found')}
        message={t('serviceCaseDetail.notFoundMessage', 'This case may have been deleted.')}
      />
    );
  const cs = c.data;

  const transitions = STATUS_FLOW[cs.status] ?? [];

  const handleSaveNote = () => {
    const trimmed = note.trim();
    if (!trimmed) return;
    // There is no dedicated case-notes table; notes are appended to the case
    // description (timestamped) through the existing PATCH endpoint. This keeps
    // the note durable and visible in the Description card with no schema change.
    const stamp = new Date().toLocaleString();
    const entry = `[Note - ${stamp}]\n${trimmed}`;
    const nextDescription = cs.description ? `${cs.description}\n\n${entry}` : entry;
    update.mutate(
      { id: cs.id, body: { description: nextDescription } },
      {
        onSuccess: () => {
          setNote('');
          toast.success(t('serviceCaseDetail.noteAddedToast', 'Note added to case'));
        },
        onError: () => toast.error(t('serviceCaseDetail.noteErrorToast', 'Could not save note')),
      },
    );
  };

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-[var(--fg-primary)] tracking-tight">
              {cs.number}
            </h1>
            <Badge
              tone={
                cs.status === 'closed'
                  ? 'gray'
                  : cs.status === 'resolved'
                    ? 'jade'
                    : cs.priority === 'high'
                      ? 'rose'
                      : 'amber'
              }
            >
              {cs.status}
            </Badge>
          </div>
          <p className="mt-1 text-lg text-[var(--fg-primary)]">{cs.subject}</p>
          <div className="mt-2 flex flex-wrap gap-2 text-sm text-[var(--fg-secondary)]">
            {cs.ownerName && (
              <span>{t('serviceCaseDetail.ownerLabel', 'Owner: {{name}}', { name: cs.ownerName })}</span>
            )}
            <span>{t('serviceCaseDetail.priorityLabel', 'Priority: {{priority}}', { priority: cs.priority })}</span>
            <span>{t('serviceCaseDetail.sourceLabel', 'Source: {{source}}', { source: cs.source })}</span>
            {cs.slaDeadline && (
              <span className={new Date(cs.slaDeadline) < new Date() ? 'text-[var(--rose-9)]' : ''}>
                {t('serviceCaseDetail.slaLabel', 'SLA: {{date}}', {
                  date: new Date(cs.slaDeadline).toLocaleDateString(),
                })}
              </span>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          {transitions.map((s) => (
            <Button
              key={s}
              size="sm"
              onClick={() =>
                update.mutate(
                  { id: cs.id, body: { status: s as never } },
                  {
                    onError: () =>
                      toast.error(
                        t('serviceCaseDetail.statusErrorToast', 'Could not update case status'),
                      ),
                  },
                )
              }
              disabled={update.isPending || !canWrite}
              title={canWrite ? undefined : readOnlyHint}
            >
              {t('serviceCaseDetail.markStatusButton', 'Mark {{status}}', {
                status: s.replace(/_/g, ' '),
              })}
            </Button>
          ))}
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Card className="p-5">
            <h3 className="text-sm font-medium text-[var(--fg-secondary)] mb-2">
              {t('serviceCaseDetail.descriptionHeading', 'Description')}
            </h3>
            <p className="text-[var(--fg-primary)] whitespace-pre-wrap">
              {cs.description ?? t('serviceCaseDetail.noDescription', 'No description provided.')}
            </p>
          </Card>

          <Card className="p-5">
            <label
              htmlFor="case-note"
              className="block text-sm font-medium text-[var(--fg-secondary)] mb-2"
            >
              {t('serviceCaseDetail.addNoteLabel', 'Add note')}
            </label>
            <textarea
              id="case-note"
              className="input w-full min-h-[80px]"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t('serviceCaseDetail.notePlaceholder', 'Write an internal note…')}
            />
            <div className="mt-2 flex justify-end">
              <Button
                size="sm"
                onClick={handleSaveNote}
                disabled={!note.trim() || update.isPending || !canWrite}
                title={canWrite ? undefined : readOnlyHint}
              >
                {update.isPending
                  ? t('serviceCaseDetail.savingButton', 'Saving…')
                  : t('serviceCaseDetail.saveNoteButton', 'Save note')}
              </Button>
            </div>
          </Card>
        </div>

        <div className="space-y-4">
          <Card className="p-5">
            <h3 className="text-sm font-medium text-[var(--fg-secondary)] mb-3">
              {t('serviceCaseDetail.detailsHeading', 'Details')}
            </h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-[var(--fg-tertiary)]">
                  {t('serviceCaseDetail.createdLabel', 'Created')}
                </span>
                <span className="text-[var(--fg-primary)]">
                  {new Date(cs.createdAt).toLocaleDateString()}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--fg-tertiary)]">
                  {t('serviceCaseDetail.updatedLabel', 'Updated')}
                </span>
                <span className="text-[var(--fg-primary)]">
                  {new Date(cs.updatedAt).toLocaleDateString()}
                </span>
              </div>
              {cs.resolvedAt && (
                <div className="flex justify-between">
                  <span className="text-[var(--fg-tertiary)]">
                    {t('serviceCaseDetail.resolvedLabel', 'Resolved')}
                  </span>
                  <span className="text-[var(--fg-primary)]">
                    {new Date(cs.resolvedAt).toLocaleDateString()}
                  </span>
                </div>
              )}
              {cs.closedAt && (
                <div className="flex justify-between">
                  <span className="text-[var(--fg-tertiary)]">
                    {t('serviceCaseDetail.closedLabel', 'Closed')}
                  </span>
                  <span className="text-[var(--fg-primary)]">
                    {new Date(cs.closedAt).toLocaleDateString()}
                  </span>
                </div>
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
