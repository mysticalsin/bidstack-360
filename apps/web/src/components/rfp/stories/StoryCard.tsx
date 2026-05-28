import { useTranslation } from 'react-i18next';

import type { StoryMatch } from '@/hooks/rfp/useRfpStoryMatches';

interface StoryCardProps {
  story: StoryMatch;
}

export function StoryCard({ story }: StoryCardProps) {
  const { t } = useTranslation('rfp');
  const hybridPct = Math.round(story.hybridScoreBps / 100);

  return (
    <li className="flex flex-col gap-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-card)] p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="truncate text-sm font-semibold text-[var(--fg-primary)]">{story.title}</p>
          <p className="mt-0.5 text-xs text-[var(--fg-secondary)]">
            {story.client} · {story.industry}
          </p>
        </div>
        {/* Hybrid score badge */}
        <span
          aria-label={`Match score: ${hybridPct}%`}
          className="shrink-0 inline-flex h-7 items-center rounded-lg bg-[var(--brand-primary)]/10 px-2 text-xs font-bold text-[var(--brand-primary)]"
        >
          {hybridPct}%
        </span>
      </div>
      <p className="text-xs leading-relaxed text-[var(--fg-secondary)]">{story.summary}</p>
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-[var(--fg-tertiary)]">
          {t('stories.matchedRequirements', { count: story.matchedRequirements.length })}
        </span>
        {story.url && (
          <a
            href={story.url}
            target="_blank"
            rel="noopener noreferrer"
            className="min-h-[44px] inline-flex items-center text-[10px] font-medium text-[var(--brand-primary)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
            aria-label={`${t('stories.viewStory')}: ${story.title}`}
          >
            {t('stories.viewStory')} ↗
          </a>
        )}
      </div>
    </li>
  );
}
