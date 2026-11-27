import { useTranslation } from 'react-i18next';

import { Card } from '@/components/ui/Card';
import { LoadingSkeleton, EmptyState } from '@/components/ui/StateMessages';
import { useRfpStoryMatches } from '@/hooks/rfp/useRfpStoryMatches';
import { useRfpPipelineStore } from '@/stores/rfpPipeline';
import { StoryCard } from './StoryCard';
import { storyMatchPhase } from './story-match-read';

export function StoryMatchPanel() {
  const { t } = useTranslation('rfp');
  const bidWorkspaceId = useRfpPipelineStore((s) => s.bidWorkspaceId);
  const storyQuery = useRfpStoryMatches(bidWorkspaceId);
  const { data, error } = storyQuery;
  // A missing payload is not an empty catalog. Empty is only a settled read.
  const phase = storyMatchPhase(storyQuery);

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

      {phase === 'unread' ? (
        <div className="p-4">
          <p role="status" className="mb-3 text-sm text-[var(--fg-secondary)]">
            {t('stories.unread', 'Checking matched stories. The list has not arrived.')}
          </p>
          <LoadingSkeleton rows={3} />
        </div>
      ) : null}

      {phase === 'failed' ? (
        <div className="p-4">
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {error instanceof Error ? error.message : t('states.error')}
          </p>
        </div>
      ) : null}

      {phase === 'ready' && data && data.items.length === 0 ? (
        <div className="p-6">
          <EmptyState title={t('stories.emptyTitle')} message={t('stories.emptyMessage')} />
        </div>
      ) : null}

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
