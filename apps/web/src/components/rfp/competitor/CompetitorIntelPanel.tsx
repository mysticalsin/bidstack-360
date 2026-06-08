import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ExternalLink, Plus, Search } from 'lucide-react';

import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { LoadingSkeleton, EmptyState } from '@/components/ui/StateMessages';
import { toast } from '@/components/ui/Toast';
import {
  useCompetitors,
  useCreateCompetitor,
  useOpportunityCompetitorInsights,
  useTriggerCompetitorResearch,
  type CompetitorInsight,
} from '@/hooks/rfp/useCompetitorIntel';

const CATEGORY_LABEL: Record<string, string> = {
  pricing: 'Pricing',
  win_loss: 'Win / loss',
  capability: 'Capability',
  positioning: 'Positioning',
  rfp_response: 'RFP response',
  news: 'News',
  other: 'Other',
};

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/** A single grounded finding. The source link is the whole point — never hidden. */
function InsightCard({ insight }: { insight: CompetitorInsight }) {
  const { t } = useTranslation('rfp');
  const confidence = Math.round(insight.confidenceBps / 100);
  return (
    <li className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-subtle)] p-4">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-sm font-semibold text-[var(--fg-primary)]">{insight.title}</h3>
        <span className="shrink-0 rounded-full border border-[var(--border-subtle)] px-2 py-0.5 text-[11px] font-medium text-[var(--fg-tertiary)]">
          {CATEGORY_LABEL[insight.category] ?? insight.category}
        </span>
      </div>
      <p className="mt-1.5 text-sm leading-relaxed text-[var(--fg-secondary)]">{insight.summary}</p>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <a
          href={insight.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-[44px] items-center gap-1.5 text-xs font-medium text-[var(--brand-primary)] hover:underline focus-visible:rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-primary)]"
        >
          <ExternalLink aria-hidden="true" className="h-3.5 w-3.5" />
          <span>{insight.sourceTitle ?? hostOf(insight.sourceUrl)}</span>
          <span className="sr-only">{t('competitor.sourceNewTab')}</span>
        </a>
        <span className="text-[11px] tabular-nums text-[var(--fg-tertiary)]">
          {confidence}% · {insight.provider}
        </span>
      </div>
    </li>
  );
}

/** Pick (or add) a competitor and run a grounded research pass. */
function ResearchControls({ opportunityId }: { opportunityId: string }) {
  const { t } = useTranslation('rfp');
  const competitors = useCompetitors();
  const createCompetitor = useCreateCompetitor();
  const research = useTriggerCompetitorResearch(opportunityId);
  const [selectedId, setSelectedId] = useState('');
  const [newName, setNewName] = useState('');

  const options = competitors.data?.items ?? [];

  async function onResearch() {
    if (!selectedId) return;
    try {
      await research.mutateAsync({ competitorId: selectedId });
      toast.success(t('competitor.queued'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('competitor.error'));
    }
  }

  async function onAdd() {
    const name = newName.trim();
    if (!name) return;
    try {
      const created = await createCompetitor.mutateAsync({ name });
      setNewName('');
      setSelectedId(created.id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('competitor.error'));
    }
  }

  return (
    <div className="flex flex-wrap items-end gap-2">
      <label className="flex flex-col gap-1 text-[11px] font-medium text-[var(--fg-tertiary)]">
        {t('competitor.selectLabel')}
        <select
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
          disabled={options.length === 0}
          className="min-h-[44px] rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-input)] px-3 text-sm text-[var(--fg-primary)] disabled:opacity-60"
        >
          <option value="">{options.length ? t('competitor.selectPlaceholder') : '—'}</option>
          {options.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <Button
        variant="primary"
        size="sm"
        onClick={() => void onResearch()}
        disabled={!selectedId || research.isPending}
      >
        <Search aria-hidden="true" className="mr-1.5 h-4 w-4" />
        {research.isPending ? t('competitor.researching') : t('competitor.research')}
      </Button>
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void onAdd();
        }}
      >
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder={t('competitor.addPlaceholder')}
          aria-label={t('competitor.addPlaceholder')}
          className="min-h-[44px] w-44 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-input)] px-3 text-sm text-[var(--fg-primary)]"
        />
        <Button variant="ghost" size="sm" type="submit" disabled={!newName.trim() || createCompetitor.isPending}>
          <Plus aria-hidden="true" className="mr-1 h-4 w-4" />
          {t('competitor.add')}
        </Button>
      </form>
    </div>
  );
}

export function CompetitorIntelPanel({ opportunityId }: { opportunityId: string | null | undefined }) {
  const { t } = useTranslation('rfp');
  const insights = useOpportunityCompetitorInsights(opportunityId);
  const items = insights.data?.items ?? [];

  return (
    <Card>
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-[var(--border-subtle)] px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-[var(--fg-primary)]">
            {t('competitor.heading')}
          </h2>
          <p className="mt-0.5 max-w-md text-xs text-[var(--fg-tertiary)]">
            {t('competitor.subtitle')}
          </p>
        </div>
        {opportunityId && <ResearchControls opportunityId={opportunityId} />}
      </div>

      {insights.isLoading && (
        <div className="p-4">
          <LoadingSkeleton rows={3} />
        </div>
      )}

      {insights.isError && (
        <div className="p-4">
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {insights.error instanceof Error ? insights.error.message : t('competitor.error')}
          </p>
        </div>
      )}

      {!insights.isLoading && !insights.isError && items.length === 0 && (
        <div className="p-6">
          <EmptyState
            title={t('competitor.emptyTitle')}
            message={t('competitor.emptyMessage')}
          />
        </div>
      )}

      {items.length > 0 && (
        <ul
          aria-label={t('competitor.listLabel')}
          role="list"
          className="grid grid-cols-1 gap-3 p-4 lg:grid-cols-2"
        >
          {items.map((insight) => (
            <InsightCard key={insight.id} insight={insight} />
          ))}
        </ul>
      )}
    </Card>
  );
}
