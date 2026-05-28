import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Card } from '@/components/ui/Card';
import { LoadingSkeleton, EmptyState } from '@/components/ui/StateMessages';
import { useRfpDraft } from '@/hooks/rfp/useRfpDraft';
import { useRfpPipelineStore } from '@/stores/rfpPipeline';
import { SectionEditor } from './SectionEditor';

export function DraftReviewPane() {
  const { t } = useTranslation('rfp');
  const bidWorkspaceId = useRfpPipelineStore((s) => s.bidWorkspaceId);
  const { query, saveSection } = useRfpDraft(bidWorkspaceId);

  const [activeSectionId, setActiveSectionId] = useState<string | null>(null);

  const { data, isLoading, isError, error } = query;

  const handleSave = (sectionId: string, content: string) => {
    saveSection.mutate({ sectionId, payload: { content, humanReviewed: true } });
  };

  return (
    <Card className="space-y-4 p-4">
      <h2 className="text-sm font-semibold text-[var(--fg-primary)]">{t('draft.heading')}</h2>

      {isLoading && <LoadingSkeleton rows={5} />}

      {isError && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error instanceof Error ? error.message : t('states.error')}
        </p>
      )}

      {!isLoading && !isError && (!data || data.sections.length === 0) && (
        <EmptyState title={t('draft.emptyTitle')} message={t('draft.emptyMessage')} />
      )}

      {data && data.sections.length > 0 && (
        <div className="space-y-3">
          {/* Section nav tabs */}
          <nav
            aria-label={t('draft.sectionNav')}
            className="flex flex-wrap gap-1.5 border-b border-[var(--border-subtle)] pb-2"
          >
            {data.sections.map((sec) => (
              <button
                key={sec.id}
                type="button"
                onClick={() => setActiveSectionId(sec.id)}
                aria-pressed={activeSectionId === sec.id}
                aria-label={sec.title}
                className={[
                  'min-h-[44px] rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
                  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500',
                  activeSectionId === sec.id
                    ? 'bg-[var(--brand-primary)] text-white'
                    : 'bg-[var(--surface-sunken)] text-[var(--fg-secondary)] hover:bg-[var(--border-subtle)]',
                ].join(' ')}
              >
                {sec.title}
                {sec.humanReviewed && (
                  <span aria-hidden="true" className="ml-1 text-[10px]">
                    ✓
                  </span>
                )}
              </button>
            ))}
          </nav>

          {/* Active editor */}
          {activeSectionId &&
            (() => {
              const sec = data.sections.find((s) => s.id === activeSectionId);
              if (!sec) return null;
              return (
                <SectionEditor
                  section={sec}
                  onSave={(content) => handleSave(sec.id, content)}
                  isSaving={saveSection.isPending}
                />
              );
            })()}

          {!activeSectionId && (
            <p className="text-sm text-[var(--fg-tertiary)]">{t('draft.selectSection')}</p>
          )}
        </div>
      )}
    </Card>
  );
}
