import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

import { GlassCard } from '@/components/ui/GlassCard';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { api } from '@/lib/api';

type ProposalStatus = 'draft' | 'review' | 'approved' | 'submitted' | 'won' | 'lost';

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

  const [editingSection, setEditingSection] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');

  if (isLoading) {
    return (
      <div aria-busy="true" aria-label="Loading proposal" className="space-y-4">
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
          Failed to load proposal
        </p>
        <p className="text-xs text-fg-tertiary mt-1">
          {error instanceof Error ? error.message : 'Please try again in a moment.'}
        </p>
        <Button
          variant="secondary"
          size="sm"
          className="mt-4"
          onClick={() => navigate('/proposals')}
        >
          Back to Proposals
        </Button>
      </GlassCard>
    );
  }

  if (!proposal) {
    return (
      <GlassCard className="py-12 text-center">
        <p className="text-fg-tertiary text-sm">Proposal not found.</p>
        <Button
          variant="secondary"
          size="sm"
          className="mt-4"
          onClick={() => navigate('/proposals')}
        >
          Back to Proposals
        </Button>
      </GlassCard>
    );
  }

  const startEdit = (section: ProposalSection) => {
    setEditingSection(section.id);
    setEditContent(section.content);
  };

  const saveEdit = (sectionId: string) => {
    updateSection.mutate({ sectionId, content: editContent });
    setEditingSection(null);
  };

  return (
    <>
      <div className="motion-page-head page-head">
        <div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => navigate('/proposals')}
              className="text-fg-tertiary hover:text-fg-secondary transition-colors"
              aria-label="Back to proposals"
            >
              <Icon name="arrow" size={16} className="rotate-180" />
            </button>
            <h1 className="page-title">{proposal.name}</h1>
          </div>
          <p className="page-sub">
            {proposal.status} · v{proposal.version}
            {proposal.dueDate ? ` · Due ${proposal.dueDate}` : ''}
          </p>
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
                    Required
                  </span>
                )}
                {section.aiDrafted && (
                  <span className="text-[10px] font-medium text-brand-primary bg-brand-primary/10 px-1.5 py-0.5 rounded flex items-center gap-1">
                    <Icon name="sparkle" size={10} />
                    AI Drafted
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-fg-muted">{section.wordCount} words</span>
                {editingSection !== section.id && (
                  <>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => draftSection.mutate(section.key)}
                      disabled={draftSection.isPending && draftSection.variables === section.key}
                    >
                      {draftSection.isPending && draftSection.variables === section.key
                        ? 'Drafting…'
                        : 'AI Draft'}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => startEdit(section)}
                      aria-label="Edit section"
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
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                />
                <div className="flex justify-end gap-2">
                  <Button variant="secondary" size="sm" onClick={() => setEditingSection(null)}>
                    Cancel
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => saveEdit(section.id)}
                    disabled={updateSection.isPending}
                  >
                    {updateSection.isPending ? 'Saving…' : 'Save'}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="prose prose-sm max-w-none text-fg-secondary whitespace-pre-wrap">
                {section.content || (
                  <p className="text-fg-muted italic">
                    No content yet. Use AI Draft to generate a first version.
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
