import { useTranslation } from 'react-i18next';

import { Card } from '@/components/ui/Card';
import { LoadingSkeleton, EmptyState } from '@/components/ui/StateMessages';
import { useRfpStoryMatches } from '@/hooks/rfp/useRfpStoryMatches';
import { useRfpPipelineStore } from '@/stores/rfpPipeline';
import { StoryCard } from './StoryCard';

export function StoryMatchPanel() {
  const { t } = useTranslation('rfp');
  const bidWorkspaceId = useRfpPipelineStore((s) => s.bidWorkspaceId);
  const { data, isLoading, isError, error } = useRfpStoryMatches(bidWorkspaceId);

  return (
    <Card>
      <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-4 py-2">
        <div>
          <h2 className="text-sm font-semibold text-[var(--fg-primary)]">{t('stories.heading')}</h2>
          {data && (
            <p className="mt-0.5 text-xs text-[var(--fg-tertiary)]">
              {t('stories.count', { count: data.total })}
            </p>
          )}
        </div>
      </div>

      {isLoading && (
        <div className="p-4">
          <LoadingSkeleton rows={3} />
        </div>
      )}

      {isError && (
        <div className="p-4">
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {error instanceof Error ? error.message : t('states.error')}
          </p>
        </div>
      )}

      {!isLoading && !isError && (!data || data.items.length === 0) && (
        <div className="p-6">
          <EmptyState title={t('stories.emptyTitle')} message={t('stories.emptyMessage')} />
        </div>
      )}

      {data && data.items.length > 0 && (
        <ul
          aria-label={t('stories.listLabel')}
          role="list"
          className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3"
        >
          {data.items.map((story) => (
            <StoryCard key={story.id} story={story} />
          ))}
        </ul>
      )}
    </Card>
  );
}
