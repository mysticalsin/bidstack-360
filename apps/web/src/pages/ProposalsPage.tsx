import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

import { GlassCard } from '@/components/ui/GlassCard';
import { Button } from '@/components/ui/Button';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { api } from '@/lib/api';
import {
  ProposalStatusChip,
  proposalStatusLabel,
  type ProposalStatus,
} from '@/components/rfp/shared/ProposalStatusChip';

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
  sections?: Array<{
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
  }>;
  createdAt: string;
  updatedAt: string;
}

interface ProposalPage {
  items: Proposal[];
  total: number;
}

export function ProposalsPage() {
  const { t } = useTranslation('rfp');
  useDocumentTitle();
  const [searchParams, setSearchParams] = useSearchParams();
  const statusFilter = (searchParams.get('status') as ProposalStatus | undefined) ?? undefined;
  // Honor the ?new=1 deep-link the RFP Response Hub's "New Proposal" shortcut
  // navigates to — open the create form on arrival instead of silently ignoring it.
  const [showCreate, setShowCreate] = useState(searchParams.get('new') === '1');
  const [newName, setNewName] = useState('');
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['proposals', statusFilter],
    queryFn: ({ signal }) => {
      const params = new URLSearchParams();
      if (statusFilter) params.set('status', statusFilter);
      params.set('limit', '50');
      return api<ProposalPage>(`/api/v1/proposals?${params.toString()}`, { signal });
    },
  });

  const create = useMutation({
    mutationFn: (body: { name: string }) =>
      api<Proposal>('/api/v1/proposals', { method: 'POST', body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['proposals'] });
      setShowCreate(false);
      setNewName('');
    },
  });

  return (
    <>
      <div className="motion-page-head page-head">
        <div>
          <h1 className="page-title">{t('proposals.title', 'Proposals')}</h1>
          <p className="page-sub">
            {t(
              'proposals.subtitle',
              'RFP workspace — draft, review, and submit winning proposals.',
            )}
          </p>
        </div>
        <Button variant="primary" size="sm" onClick={() => setShowCreate(true)}>
          {t('proposals.newProposal', 'New Proposal')}
        </Button>
      </div>

      {showCreate && (
        <GlassCard className="mb-4">
          <h3 className="text-sm font-semibold mb-2">
            {t('proposals.createProposal', 'Create Proposal')}
          </h3>
          <div className="flex gap-2">
            <input
              className="dialog-input flex-1"
              aria-label={t('proposals.nameLabel', 'Proposal name')}
              placeholder={t('proposals.namePlaceholder', 'Proposal name…')}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && newName.trim()) create.mutate({ name: newName });
              }}
            />
            <Button
              variant="primary"
              size="sm"
              onClick={() => create.mutate({ name: newName })}
              disabled={!newName.trim() || create.isPending}
            >
              {create.isPending
                ? t('proposals.creating', 'Creating…')
                : t('proposals.create', 'Create')}
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setShowCreate(false)}>
              {t('proposals.cancel', 'Cancel')}
            </Button>
          </div>
          {create.isError && (
            <p className="mt-2 text-xs text-red-600 dark:text-red-400" role="alert">
              {create.error instanceof Error
                ? create.error.message
                : t('proposals.createError', 'Failed to create proposal.')}
            </p>
          )}
        </GlassCard>
      )}

      <GlassCard className="mb-4">
        <div
          role="group"
          aria-label={t('proposals.filterByStatus', 'Filter by status')}
          className="flex gap-2 flex-wrap"
        >
          {(['draft', 'review', 'approved', 'submitted', 'won', 'lost'] as ProposalStatus[]).map(
            (s) => (
              <button
                key={s}
                aria-pressed={statusFilter === s}
                className={`px-3 py-1 rounded-full text-xs font-medium border ${
                  statusFilter === s
                    ? 'bg-brand-primary text-white border-brand-primary'
                    : 'bg-surface-sunken text-fg-secondary border-border-subtle'
                }`}
                onClick={() => {
                  if (statusFilter === s) setSearchParams({});
                  else setSearchParams({ status: s });
                }}
              >
                {proposalStatusLabel(s)}
              </button>
            ),
          )}
        </div>
      </GlassCard>

      {/* sr-only live region — announces filter result count to AT */}
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {!isLoading && data
          ? `${t('proposals.resultCount', '{{count}} proposals', { count: data.items.length })}${statusFilter ? ` · ${statusFilter}` : ''}`
          : ''}
      </p>

      {isLoading ? (
        <div
          className="grid grid-cols-1 gap-3"
          aria-busy="true"
          aria-label={t('proposals.loading', 'Loading proposals')}
        >
          {[1, 2, 3].map((i) => (
            <GlassCard key={i} padding="md" className="animate-pulse">
              <div className="h-4 bg-surface-sunken rounded w-2/3 mb-2" />
              <div className="h-3 bg-surface-sunken rounded w-1/3" />
            </GlassCard>
          ))}
        </div>
      ) : isError ? (
        <GlassCard className="py-12 text-center" role="alert">
          <p className="text-sm font-medium text-red-600 dark:text-red-400">
            {t('proposals.loadError', 'Failed to load proposals')}
          </p>
          <p className="text-xs text-fg-tertiary mt-1">
            {error instanceof Error
              ? error.message
              : t('proposals.loadErrorRetry', 'Please try again in a moment.')}
          </p>
        </GlassCard>
      ) : data?.items.length === 0 ? (
        <GlassCard className="py-12 text-center">
          <p className="text-fg-tertiary text-sm">{t('proposals.emptyTitle', 'No proposals yet.')}</p>
          <p className="text-fg-muted text-xs mt-1">
            {t('proposals.emptyMessage', 'Create your first proposal to get started.')}
          </p>
        </GlassCard>
      ) : (
        <div className="grid grid-cols-1 gap-3">
          {data?.items.map((p) => (
            <GlassCard
              key={p.id}
              padding="md"
              role="button"
              tabIndex={0}
              aria-label={t('proposals.viewProposal', 'View proposal: {{name}}', {
                name: p.name,
              })}
              className="flex items-center justify-between gap-4 cursor-pointer hover:bg-surface-sunken/50 transition-colors"
              onClick={() => navigate(`/proposals/${p.id}`)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  navigate(`/proposals/${p.id}`);
                }
              }}
            >
              <div className="min-w-0">
                <p className="text-sm font-semibold text-fg-primary truncate">{p.name}</p>
                <p className="text-xs text-fg-tertiary mt-0.5">
                  {t('proposals.version', 'v{{version}}', { version: p.version })}
                  {p.dueDate
                    ? ` · ${t('proposals.due', 'Due {{date}}', {
                        date: new Date(p.dueDate).toLocaleDateString(),
                      })}`
                    : ''}
                </p>
              </div>
              <ProposalStatusChip status={p.status} />
            </GlassCard>
          ))}
        </div>
      )}
    </>
  );
}
