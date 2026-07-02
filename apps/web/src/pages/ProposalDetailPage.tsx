import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { GlassCard } from '@/components/ui/GlassCard';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { api } from '@/lib/api';
import { confirm } from '@/components/ui/ConfirmDialog';
import {
  ProposalStatusChip,
  proposalStatusLabel,
  PROPOSAL_STATUS_LABELS,
  type ProposalStatus,
} from '@/components/rfp/shared/ProposalStatusChip';
import { useHasPermission } from '@/hooks/useCapabilities';

interface ProposalSection {
  id: string;
  proposalId: string;
  key: string;
  title: string;
  content: string;
  wordCount: number;
  aiDrafted: boolean;
  sortOrder: number;
  required: boolean;
  createdAt: string;
  updatedAt: string;
}

interface Proposal {
  id: string;
  orgId: string;
  opportunityId: string | null;
  name: string;
  status: ProposalStatus;
  version: number;
  ownerId: string | null;
  complianceScore: number | null;
  dueDate: string | null;
  sections: ProposalSection[];
  createdAt: string;
  updatedAt: string;
}

export function ProposalDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { t } = useTranslation('rfp');
  const canWrite = useHasPermission('proposals:write');
  useDocumentTitle();

  const {
    data: proposal,
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ['proposal', id],
    queryFn: async () => {
      if (!id) return null;
      return api<Proposal>(`/api/v1/proposals/${id}`);
    },
    enabled: Boolean(id),
  });

  const draftSection = useMutation({
    mutationFn: async (sectionKey: string) => {
      if (!id) throw new Error('No proposal ID');
      return api<{ sectionKey: string; content: string; wordCount: number; sources: string[] }>(
        `/api/v1/proposals/${id}/draft`,
        {
          method: 'POST',
          body: { sectionKey, context: '' },
        },
      );
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['proposal', id] });
    },
  });

  const updateSection = useMutation({
    mutationFn: async ({ sectionId, content }: { sectionId: string; content: string }) => {
      if (!id) throw new Error('No proposal ID');
      return api<{ id: string; wordCount: number }>(
        `/api/v1/proposals/${id}/sections/${sectionId}`,
        {
          method: 'PATCH',
          body: { content },
        },
      );
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['proposal', id] });
    },
  });

  // Move the proposal through its lifecycle. The backend PATCH drives real
  // side-effects (webhook fan-out on 'submitted', MemOS win/loss on won/lost),
  // so this was the missing UI for an otherwise-complete flow.
  const updateStatus = useMutation({
    mutationFn: async (status: ProposalStatus) => {
      if (!id) throw new Error('No proposal ID');
      return api<Proposal>(`/api/v1/proposals/${id}`, { method: 'PATCH', body: { status } });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['proposal', id] });
    },
  });

  const deleteProposal = useMutation({
    mutationFn: async () => {
      if (!id) throw new Error('No proposal ID');
      return api(`/api/v1/proposals/${id}`, { method: 'DELETE' });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['proposals'] });
      navigate('/proposals');
    },
  });

  const updateDueDate = useMutation({
    mutationFn: async (dueDate: string | null) => {
      if (!id) throw new Error('No proposal ID');
      return api<Proposal>(`/api/v1/proposals/${id}`, { method: 'PATCH', body: { dueDate } });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['proposal', id] });
    },
  });

  const [editingSection, setEditingSection] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');

  if (isLoading) {
    return (
      <div
        aria-busy="true"
        aria-label={t('proposalDetail.loadingAriaLabel', 'Loading proposal')}
        className="space-y-4"
      >
        <div className="animate-pulse h-8 bg-surface-sunken rounded w-1/2" />
        {[1, 2, 3].map((i) => (
          <GlassCard key={i} padding="md" className="animate-pulse space-y-2">
            <div className="h-4 bg-surface-sunken rounded w-1/3" />
            <div className="h-20 bg-surface-sunken rounded" />
          </GlassCard>
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <GlassCard className="py-12 text-center" role="alert">
        <p className="text-sm font-medium text-red-600 dark:text-red-400">
          {t('proposalDetail.errorTitle', 'Failed to load proposal')}
        </p>
        <p className="text-xs text-fg-tertiary mt-1">
          {error instanceof Error
            ? error.message
            : t('proposalDetail.errorRetry', 'Please try again in a moment.')}
        </p>
        <Button
          variant="secondary"
          size="sm"
          className="mt-4"
          onClick={() => navigate('/proposals')}
        >
          {t('proposalDetail.backToProposals', 'Back to Proposals')}
        </Button>
      </GlassCard>
    );
  }

  if (!proposal) {
    return (
      <GlassCard className="py-12 text-center">
        <p className="text-fg-tertiary text-sm">
          {t('proposalDetail.notFound', 'Proposal not found.')}
        </p>
        <Button
          variant="secondary"
          size="sm"
          className="mt-4"
          onClick={() => navigate('/proposals')}
        >
          {t('proposalDetail.backToProposals', 'Back to Proposals')}
        </Button>
      </GlassCard>
    );
  }

  const startEdit = (section: ProposalSection) => {
    setEditingSection(section.id);
    setEditContent(section.content);
  };

  const saveEdit = (sectionId: string) => {
    // Close the editor only on success — closing eagerly discarded the typed
    // content when the save failed (silent data loss). The mutation's own
    // onSuccess (cache invalidation) still runs alongside this callback.
    updateSection.mutate(
      { sectionId, content: editContent },
      { onSuccess: () => setEditingSection(null) },
    );
  };

  const handleStatusChange = (next: ProposalStatus) => {
    if (!proposal || next === proposal.status) return;
    // Confirm terminal outcomes — they crystallize win/loss in MemOS + notify
    // connected integrations via webhook fan-out, so they are not casual changes.
    if (
      (next === 'won' || next === 'lost') &&
      !window.confirm(
        t(
          'proposalDetail.confirmTerminalStatus',
          'Mark this proposal as "{{status}}"? This records the outcome and notifies connected integrations.',
          { status: proposalStatusLabel(next) },
        ),
      )
    ) {
      return;
    }
    updateStatus.mutate(next);
  };

  const handleDelete = async () => {
    const ok = await confirm({
      title: t('proposalDetail.confirmDelete.title', 'Delete this proposal?'),
      description: t(
        'proposalDetail.confirmDelete.description',
        'This permanently removes the proposal and all its sections. This cannot be undone.',
      ),
      confirmLabel: t('proposalDetail.confirmDelete.confirm', 'Delete'),
      destructive: true,
    });
    if (ok) deleteProposal.mutate();
  };

  return (
    <>
      <div className="motion-page-head page-head">
        <div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => navigate('/proposals')}
              className="text-fg-tertiary hover:text-fg-secondary transition-colors"
              aria-label={t('proposalDetail.backToProposalsAriaLabel', 'Back to proposals')}
            >
              <Icon name="arrow" size={16} className="rotate-180" />
            </button>
            <h1 className="page-title">{proposal.name}</h1>
            {canWrite ? (
              <>
                <label htmlFor="proposal-status" className="sr-only">
                  {t('proposalDetail.statusLabel', 'Proposal status')}
                </label>
                <select
                  id="proposal-status"
                  value={proposal.status}
                  disabled={updateStatus.isPending}
                  onChange={(e) => handleStatusChange(e.target.value as ProposalStatus)}
                  className="rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-xs font-medium disabled:opacity-60"
                >
                  {(Object.keys(PROPOSAL_STATUS_LABELS) as ProposalStatus[]).map((s) => (
                    <option key={s} value={s}>
                      {proposalStatusLabel(s)}
                    </option>
                  ))}
                </select>
              </>
            ) : (
              <ProposalStatusChip status={proposal.status} />
            )}
            {canWrite && (
              <label className="flex items-center gap-1">
                <span className="sr-only">{t('proposalDetail.dueDateLabel', 'Due date')}</span>
                <input
                  type="date"
                  value={proposal.dueDate ? proposal.dueDate.slice(0, 10) : ''}
                  disabled={updateDueDate.isPending}
                  onChange={(e) =>
                    // The API schema requires YYYY-MM-DD (z.string().date()); the
                    // native date input's value is already in that format, so
                    // wrapping it in new Date().toISOString() (a full timestamp)
                    // 400'd on every save.
                    updateDueDate.mutate(e.target.value || null)
                  }
                  aria-label={t('proposalDetail.dueDateLabel', 'Due date')}
                  className="rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-xs disabled:opacity-60"
                />
              </label>
            )}
            {canWrite && (
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleteProposal.isPending}
                aria-label={t('proposalDetail.deleteAriaLabel', 'Delete proposal')}
                className="ml-auto inline-flex h-8 items-center gap-1 rounded px-2 text-xs font-medium text-[var(--danger)] hover:bg-[var(--danger)]/10 disabled:opacity-60"
              >
                <Icon name="trash" size={13} />
                {deleteProposal.isPending
                  ? t('proposalDetail.deleting', 'Deleting…')
                  : t('proposalDetail.deleteButton', 'Delete')}
              </button>
            )}
          </div>
          <p className="page-sub">
            {t('proposalDetail.version', 'v{{version}}', { version: proposal.version })}
            {proposal.dueDate
              ? ` · ${t('proposalDetail.due', 'Due {{date}}', {
                  date: new Date(proposal.dueDate).toLocaleDateString(),
                })}`
              : ''}
          </p>
          {updateStatus.isError && (
            <p role="alert" className="mt-1 text-xs text-[var(--danger)]">
              {t('proposalDetail.statusUpdateError', 'Could not update status. Please try again.')}
            </p>
          )}
          {updateDueDate.isError && (
            <p role="alert" className="mt-1 text-xs text-[var(--danger)]">
              {t('proposalDetail.dueDateUpdateError', 'Could not update due date. Please try again.')}
            </p>
          )}
          {deleteProposal.isError && (
            <p role="alert" className="mt-1 text-xs text-[var(--danger)]">
              {t('proposalDetail.deleteError', 'Could not delete the proposal. Please try again.')}
            </p>
          )}
        </div>
      </div>

      <div className="space-y-4">
        {proposal.sections.map((section) => (
          <GlassCard key={section.id} padding="lg">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-fg-primary">{section.title}</h3>
                {section.required && (
                  <span className="text-[10px] font-medium text-danger bg-danger/10 px-1.5 py-0.5 rounded">
                    {t('proposalDetail.requiredBadge', 'Required')}
                  </span>
                )}
                {section.aiDrafted && (
                  <span className="text-[10px] font-medium text-brand-primary bg-brand-primary/10 px-1.5 py-0.5 rounded flex items-center gap-1">
                    <Icon name="sparkle" size={10} />
                    {t('proposalDetail.aiDraftedBadge', 'AI Drafted')}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-fg-muted">
                  {t('proposalDetail.wordCount', '{{count}} words', { count: section.wordCount })}
                </span>
                {editingSection !== section.id && (
                  <>
                    <Button
                      variant="secondary"
                      size="sm"
                      aria-label={
                        draftSection.isPending && draftSection.variables === section.key
                          ? t('proposalDetail.draftingSectionAriaLabel', 'Drafting {{title}}…', {
                              title: section.title,
                            })
                          : t('proposalDetail.aiDraftSectionAriaLabel', 'AI Draft for {{title}}', {
                              title: section.title,
                            })
                      }
                      onClick={() => draftSection.mutate(section.key)}
                      disabled={draftSection.isPending && draftSection.variables === section.key}
                    >
                      {draftSection.isPending && draftSection.variables === section.key
                        ? t('proposalDetail.drafting', 'Drafting…')
                        : t('proposalDetail.aiDraft', 'AI Draft')}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => startEdit(section)}
                      aria-label={t('proposalDetail.editSectionAriaLabel', 'Edit {{title}} section', {
                        title: section.title,
                      })}
                    >
                      <Icon name="pencil" size={14} />
                    </Button>
                  </>
                )}
              </div>
            </div>

            {editingSection === section.id ? (
              <div className="space-y-2">
                <textarea
                  className="dialog-input min-h-[200px] resize-y w-full font-mono text-sm"
                  aria-label={t('proposalDetail.editContentAriaLabel', 'Edit content for {{title}}', {
                    title: section.title,
                  })}
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                />
                {updateSection.isError && (
                  <p role="alert" className="text-xs text-[var(--danger)]">
                    {t(
                      'proposalDetail.sectionSaveError',
                      'Could not save. Your changes are kept — try again.',
                    )}
                  </p>
                )}
                <div className="flex justify-end gap-2">
                  <Button variant="secondary" size="sm" onClick={() => setEditingSection(null)}>
                    {t('proposalDetail.cancel', 'Cancel')}
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => saveEdit(section.id)}
                    disabled={updateSection.isPending}
                  >
                    {updateSection.isPending
                      ? t('proposalDetail.saving', 'Saving…')
                      : t('proposalDetail.save', 'Save')}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="prose prose-sm max-w-none text-fg-secondary whitespace-pre-wrap">
                {section.content || (
                  <p className="text-fg-muted italic">
                    {t(
                      'proposalDetail.emptyContent',
                      'No content yet. Use AI Draft to generate a first version.',
                    )}
                  </p>
                )}
              </div>
            )}
          </GlassCard>
        ))}
      </div>
    </>
  );
}
