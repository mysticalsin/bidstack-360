import { useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

import { GlassCard } from '@/components/ui/GlassCard';
import { Button } from '@/components/ui/Button';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { api } from '@/lib/api';
type ProposalStatus = 'draft' | 'review' | 'approved' | 'submitted' | 'won' | 'lost';

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
  useDocumentTitle();
  const [searchParams, setSearchParams] = useSearchParams();
  const statusFilter = (searchParams.get('status') as ProposalStatus | undefined) ?? undefined;
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['proposals', statusFilter],
    queryFn: ({ signal }) => {
      const params = new URLSearchParams();
      if (statusFilter) params.set('status', statusFilter);
      params.set('limit', '50');
      return api<ProposalPage>(`/api/v1/proposals?${params.toString()}`, { signal });
    },
  });

  const create = useMutation({
    mutationFn: (body: { name: string }) => api<Proposal>('/api/v1/proposals', { method: 'POST', body }),
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
          <h1 className="page-title">Proposals</h1>
          <p className="page-sub">RFP workspace — draft, review, and submit winning proposals.</p>
        </div>
        <Button variant="primary" size="sm" onClick={() => setShowCreate(true)}>
          New Proposal
        </Button>
      </div>

      {showCreate && (
        <GlassCard className="mb-4">
          <h3 className="text-sm font-semibold mb-2">Create Proposal</h3>
          <div className="flex gap-2">
            <input
              className="dialog-input flex-1"
              placeholder="Proposal name…"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
            <Button
              variant="primary"
              size="sm"
              onClick={() => create.mutate({ name: newName })}
              disabled={!newName.trim() || create.isPending}
            >
              {create.isPending ? 'Creating…' : 'Create'}
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setShowCreate(false)}>
              Cancel
            </Button>
          </div>
        </GlassCard>
      )}

      <GlassCard className="mb-4">
        <div className="flex gap-2 flex-wrap">
          {(['draft', 'review', 'approved', 'submitted', 'won', 'lost'] as ProposalStatus[]).map((s) => (
            <button
              key={s}
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
              {s}
            </button>
          ))}
        </div>
      </GlassCard>

      {isLoading ? (
        <p className="text-fg-tertiary text-sm">Loading proposals…</p>
      ) : data?.items.length === 0 ? (
        <GlassCard className="py-12 text-center">
          <p className="text-fg-tertiary text-sm">No proposals yet.</p>
          <p className="text-fg-muted text-xs mt-1">Create your first proposal to get started.</p>
        </GlassCard>
      ) : (
        <div className="grid grid-cols-1 gap-3">
          {data?.items.map((p) => (
            <GlassCard
              key={p.id}
              padding="md"
              className="flex items-center justify-between gap-4 cursor-pointer hover:bg-surface-sunken/50 transition-colors"
              onClick={() => navigate(`/proposals/${p.id}`)}
            >
              <div className="min-w-0">
                <p className="text-sm font-semibold text-fg-primary truncate">{p.name}</p>
                <p className="text-xs text-fg-tertiary mt-0.5">
                  {p.status} · v{p.version}
                  {p.dueDate ? ` · Due ${p.dueDate}` : ''}
                </p>
              </div>
              <span
                className={`px-2 py-0.5 rounded-full text-[10px] font-medium uppercase ${
                  p.status === 'won'
                    ? 'bg-emerald-100 text-emerald-700'
                    : p.status === 'lost'
                      ? 'bg-rose-100 text-rose-700'
                      : p.status === 'submitted'
                        ? 'bg-blue-100 text-blue-700'
                        : 'bg-surface-sunken text-fg-secondary'
                }`}
              >
                {p.status}
              </span>
            </GlassCard>
          ))}
        </div>
      )}
    </>
  );
}
