import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { LeadPriorityBadge, LeadStatusBadge } from '@/components/lead/LeadStatusBadge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { confirm } from '@/components/ui/ConfirmDialog';
import { Icon } from '@/components/ui/Icon';
import { EmptyState, ErrorState } from '@/components/ui/StateMessages';
import { DetailPageSkeleton } from '@/components/skeletons/DetailPageSkeleton';
import { toast } from '@/components/ui/Toast';
import { useConvertLead, useDeleteLead, useLead, useUpdateLead } from '@/hooks/useLeads';
import { useDebouncedCallback } from '@/hooks/useDebouncedCallback';
import { DraftInput, DraftTextarea } from '@/components/ui/DraftInput';
import { CustomFieldValuesSection } from '@/components/CustomFieldValuesSection';
import { CollaborativeNotesSection } from '@/components/editor/CollaborativeNotesSection';
import { formatDate } from '@/lib/format';
import { LeadPriority, LeadStatus, LeadSource } from '@bidstack/shared';

import { ConvertLeadDialog } from './leadDetail/ConvertLeadDialog';

const STATUS_OPTIONS: LeadStatus[] = [
  'new',
  'contacted',
  'qualified',
  'nurture',
  'disqualified',
  'converted',
];
const PRIORITY_OPTIONS: LeadPriority[] = ['low', 'medium', 'high', 'critical'];

export function LeadDetailPage() {
  const { t } = useTranslation('crm');
  const { id } = useParams<{ id: string }>();
  const nav = useNavigate();
  const lead = useLead(id ?? '');
  const update = useUpdateLead(id ?? '');
  const convert = useConvertLead(id ?? '');
  const del = useDeleteLead();
  const { debounced: debouncedUpdate } = useDebouncedCallback((patch: Record<string, unknown>) => {
    update.mutate(patch as Parameters<typeof update.mutate>[0], {
      onSuccess: () => toast.success(t('leadDetail.toastSaved', 'Saved')),
      onError: () => toast.error(t('leadDetail.toastSaveFailed', 'Save failed')),
    });
  }, 500);
  const [isConverting, setIsConverting] = useState(false);

  if (lead.isLoading) return <DetailPageSkeleton columns={2} cards={3} />;
  if (lead.isError) {
    return (
      <ErrorState
        title={t('leadDetail.errorTitle', "Couldn't load lead")}
        message={t('leadDetail.errorMessage', 'The lead may have been deleted.')}
      />
    );
  }
  if (!lead.data) {
    return (
      <EmptyState
        title={t('leadDetail.notFoundTitle', 'Lead not found')}
        message={t(
          'leadDetail.notFoundMessage',
          'The lead may have been deleted or you may not have access to it.',
        )}
        action={
          <Button variant="secondary" onClick={() => window.history.back()}>
            {t('leadDetail.goBack', 'Go back')}
          </Button>
        }
      />
    );
  }

  const l = lead.data;
  const canConvert = l.status !== 'converted' && l.status !== 'disqualified';
  const isConverted = l.status === 'converted';

  const handleStatusChange = (status: LeadStatus) => {
    update.mutate(
      { status },
      { onSuccess: () => toast.success(t('leadDetail.toastStatusUpdated', 'Status updated')) },
    );
  };

  const handlePriorityChange = (priority: LeadPriority) => {
    update.mutate(
      { priority },
      { onSuccess: () => toast.success(t('leadDetail.toastPriorityUpdated', 'Priority updated')) },
    );
  };

  const handleConvert = (form: Parameters<typeof convert.mutate>[0]) => {
    convert.mutate(form, {
      onSuccess: (data) => {
        toast.success(t('leadDetail.toastConverted', 'Lead converted successfully'));
        setIsConverting(false);
        nav(`/opportunities/${data.opportunityId}`);
      },
      onError: () => toast.error(t('leadDetail.toastConvertFailed', 'Failed to convert lead')),
    });
  };

  const handleDelete = async () => {
    const ok = await confirm({
      title: t('leadDetail.deleteConfirmTitle', 'Delete lead?'),
      description: t(
        'leadDetail.deleteConfirmDescription',
        'This will permanently remove {{firstName}} {{lastName}} from your leads.',
        { firstName: l.firstName, lastName: l.lastName },
      ),
      confirmLabel: t('leadDetail.deleteConfirmLabel', 'Delete'),
      destructive: true,
    });
    if (!ok) return;
    del.mutate(l.id, {
      onSuccess: () => toast.success(t('leadDetail.toastDeleted', 'Lead deleted')),
    });
  };

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <nav aria-label={t('leadDetail.breadcrumbAriaLabel', 'Breadcrumb')}>
        <ol className="flex items-center gap-2 text-xs text-[var(--fg-tertiary)]">
          <li>
            <Link to="/leads" className="hover:text-[var(--fg-primary)]">
              {t('leadDetail.breadcrumbLeads', 'Leads')}
            </Link>
          </li>
          <li aria-hidden>/</li>
          <li aria-current="page" className="text-[var(--fg-primary)]">
            {l.firstName} {l.lastName}
          </li>
        </ol>
      </nav>

      {/* Header */}
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-4 p-5">
          <div className="flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight text-[var(--fg-primary)]">
                {l.firstName} {l.lastName}
              </h1>
              <LeadStatusBadge status={l.status} />
              <LeadPriorityBadge priority={l.priority} />
            </div>
            {l.title && <p className="mt-1 text-sm text-[var(--fg-secondary)]">{l.title}</p>}
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-[var(--fg-secondary)]">
              {l.email && (
                <span className="flex items-center gap-1.5">
                  <Icon name="mail" size={12} />
                  <a href={`mailto:${l.email}`} className="hover:text-[var(--brand-primary)]">
                    {l.email}
                  </a>
                </span>
              )}
              {l.phone && (
                <span className="flex items-center gap-1.5">
                  <Icon name="phone" size={12} />
                  <a href={`tel:${l.phone}`} className="hover:text-[var(--brand-primary)]">
                    {l.phone}
                  </a>
                </span>
              )}
              {l.companyName && (
                <span className="flex items-center gap-1.5">
                  <Icon name="building" size={12} />
                  {l.companyName}
                </span>
              )}
              {l.source && (
                <span className="flex items-center gap-1.5 capitalize">
                  <Icon name="link" size={12} />
                  {l.source}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {canConvert ? (
              <Button data-testid="lead-convert-action" onClick={() => setIsConverting(true)}>
                {t('leadDetail.convertAction', 'Convert to opportunity')}
              </Button>
            ) : (
              <Button data-testid="lead-convert-action" disabled variant="secondary">
                {t('leadDetail.convertUnavailable', 'Convert lead unavailable')}
              </Button>
            )}
            <Button variant="ghost" onClick={handleDelete}>
              {t('leadDetail.deleteAction', 'Delete')}
            </Button>
          </div>
        </div>
      </Card>

      {/* Conversion dialog */}
      {isConverting && (
        <ConvertLeadDialog
          companyName={l.companyName}
          isPending={convert.isPending}
          onClose={() => setIsConverting(false)}
          onConvert={handleConvert}
        />
      )}

      {/* Converted banner */}
      {isConverted && l.convertedToOpportunityId && (
        <Card className="border border-[var(--success)]/30 bg-[var(--success-tint)]">
          <div className="flex items-center gap-3 p-4">
            <Icon name="check" size={16} className="text-[var(--success)]" />
            <span className="text-sm text-[var(--fg-primary)]">
              {t('leadDetail.convertedBannerPrefix', 'This lead was converted to')}{' '}
              <Link
                to={`/opportunities/${l.convertedToOpportunityId}`}
                className="font-medium text-[var(--brand-primary)] hover:underline"
              >
                {t('leadDetail.convertedBannerLink', 'converted opportunity')}
              </Link>
              .
            </span>
          </div>
        </Card>
      )}

      {/* Details grid */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Status & scoring */}
        <Card>
          <div className="p-5">
            <h3 className="text-sm font-semibold text-[var(--fg-primary)]">
              {t('leadDetail.statusScoringHeading', 'Status & scoring')}
            </h3>
            <div className="mt-4 grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1 block text-xs text-[var(--fg-tertiary)]">
                  {t('leadDetail.labelStatus', 'Status')}
                </label>
                <select
                  value={l.status}
                  onChange={(e) => handleStatusChange(LeadStatus.parse(e.target.value))}
                  disabled={isConverted}
                  className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-3 py-2 text-sm text-[var(--fg-primary)] outline-none focus:border-[var(--brand-primary)] disabled:opacity-50"
                >
                  {STATUS_OPTIONS.map((s) => (
                    <option key={s} value={s}>
                      {s.charAt(0).toUpperCase() + s.slice(1)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs text-[var(--fg-tertiary)]">
                  {t('leadDetail.labelPriority', 'Priority')}
                </label>
                <select
                  value={l.priority}
                  onChange={(e) => handlePriorityChange(LeadPriority.parse(e.target.value))}
                  className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-3 py-2 text-sm text-[var(--fg-primary)] outline-none focus:border-[var(--brand-primary)]"
                >
                  {PRIORITY_OPTIONS.map((p) => (
                    <option key={p} value={p}>
                      {p.charAt(0).toUpperCase() + p.slice(1)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs text-[var(--fg-tertiary)]">
                  {t('leadDetail.labelScore', 'Score')}
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={l.score}
                    onChange={(e) => debouncedUpdate({ score: Number(e.target.value) })}
                    className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-3 py-2 text-sm text-[var(--fg-primary)] outline-none focus:border-[var(--brand-primary)]"
                  />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs text-[var(--fg-tertiary)]">
                  {t('leadDetail.labelSource', 'Source')}
                </label>
                <select
                  value={l.source}
                  onChange={(e) => update.mutate({ source: LeadSource.parse(e.target.value) })}
                  className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-3 py-2 text-sm text-[var(--fg-primary)] outline-none focus:border-[var(--brand-primary)]"
                >
                  {LeadSource.options.map((s) => (
                    <option key={s} value={s}>
                      {s.replace('_', ' ').replace(/^\w/, (c) => c.toUpperCase())}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        </Card>

        {/* BANT */}
        <Card>
          <div className="p-5">
            <h3 className="text-sm font-semibold text-[var(--fg-primary)]">
              {t('leadDetail.bantHeading', 'BANT qualification')}
            </h3>
            <div className="mt-4 grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1 block text-xs text-[var(--fg-tertiary)]">
                  {t('leadDetail.labelBudget', 'Budget')}
                </label>
                <DraftInput
                  type="text"
                  serverValue={l.budget ?? ''}
                  commit={(v) => update.mutate({ budget: v || null })}
                  placeholder={t('leadDetail.placeholderBudget', 'e.g. €500K')}
                  className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-3 py-2 text-sm text-[var(--fg-primary)] outline-none focus:border-[var(--brand-primary)]"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-[var(--fg-tertiary)]">
                  {t('leadDetail.labelAuthority', 'Authority')}
                </label>
                <DraftInput
                  type="text"
                  serverValue={l.authority ?? ''}
                  commit={(v) => update.mutate({ authority: v || null })}
                  placeholder={t('leadDetail.placeholderAuthority', 'Decision maker')}
                  className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-3 py-2 text-sm text-[var(--fg-primary)] outline-none focus:border-[var(--brand-primary)]"
                />
              </div>
              <div className="col-span-2">
                <label className="mb-1 block text-xs text-[var(--fg-tertiary)]">
                  {t('leadDetail.labelNeed', 'Need')}
                </label>
                <DraftTextarea
                  serverValue={l.need ?? ''}
                  commit={(v) => update.mutate({ need: v || null })}
                  placeholder={t(
                    'leadDetail.placeholderNeed',
                    'What problem are they trying to solve?',
                  )}
                  rows={2}
                  className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-3 py-2 text-sm text-[var(--fg-primary)] outline-none focus:border-[var(--brand-primary)] focus:ring-2 focus:ring-[var(--brand-primary)]/20"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-[var(--fg-tertiary)]">
                  {t('leadDetail.labelTimeline', 'Timeline')}
                </label>
                <DraftInput
                  type="text"
                  serverValue={l.timeline ?? ''}
                  commit={(v) => update.mutate({ timeline: v || null })}
                  placeholder={t('leadDetail.placeholderTimeline', 'e.g. Q2 2026')}
                  className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-3 py-2 text-sm text-[var(--fg-primary)] outline-none focus:border-[var(--brand-primary)]"
                />
              </div>
            </div>
          </div>
        </Card>

        {/* Notes */}
        <Card className="lg:col-span-2">
          <div className="p-5">
            <label className="text-sm font-semibold text-[var(--fg-primary)]" htmlFor="lead-notes">
              {t('leadDetail.labelNotes', 'Notes')}
            </label>
            <DraftTextarea
              id="lead-notes"
              serverValue={l.notes ?? ''}
              commit={(v) => update.mutate({ notes: v || null })}
              placeholder={t('leadDetail.placeholderNotes', 'Add notes about this lead…')}
              rows={4}
              className="mt-3 w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-3 py-2 text-sm text-[var(--fg-primary)] outline-none focus:border-[var(--brand-primary)] focus:ring-2 focus:ring-[var(--brand-primary)]/20"
            />
          </div>
        </Card>

        {/* Metadata */}
        <Card className="lg:col-span-2">
          <div className="flex flex-wrap gap-x-6 gap-y-2 p-4 text-xs text-[var(--fg-tertiary)]">
            <span>{t('leadDetail.metaCreated', 'Created {{date}}', { date: formatDate(l.createdAt) })}</span>
            <span>{t('leadDetail.metaUpdated', 'Updated {{date}}', { date: formatDate(l.updatedAt) })}</span>
            {l.ownerName && (
              <span>{t('leadDetail.metaOwner', 'Owner: {{name}}', { name: l.ownerName })}</span>
            )}
          </div>
        </Card>
      </div>

      <CustomFieldValuesSection entityType="lead" entityId={id!} />

      {/* Wave 8 — Collaborative scratch-pad: real-time CRDT rich-text. */}
      <CollaborativeNotesSection
        entityType="lead"
        entityId={id}
        fieldKey="notes"
        label={t('leadDetail.liveCollaboration', 'Live collaboration')}
      />
    </div>
  );
}
