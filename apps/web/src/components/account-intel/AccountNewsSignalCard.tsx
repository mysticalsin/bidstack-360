// Free company news / intent signal on the account view. Source-tagged as
// EXTERNAL / open-web so it's never confused with internal Mantu project facts
// (the demo's "le vrai du faux" rule). Keyless — Google News RSS via the API.

import { useTranslation } from 'react-i18next';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, SectionHeader } from '@/components/ui/Card';
import { EmptyState, ErrorState, LoadingSkeleton } from '@/components/ui/StateMessages';
import { useAccountNews } from '@/hooks/useAccountNews';
import { SourceBadge } from '@/components/cockpit/SourceBadge';
import type { SourceAttribution } from '@bidstack/shared';

function when(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString();
}

function attributionFor(
  attribution: SourceAttribution | undefined,
  fetchedAt: string | undefined,
): SourceAttribution {
  return (
    attribution ?? {
      source: 'google_news_open_web',
      label: 'Google News',
      sourceUrl: 'https://news.google.com/',
      fetchedAt: fetchedAt ?? new Date(0).toISOString(),
      confidence: 0.55,
      providerMetadata: { signalType: 'public_news' },
    }
  );
}

export function AccountNewsSignalCard({ accountId }: { accountId: string }) {
  const { t } = useTranslation('crm');
  const news = useAccountNews(accountId);
  const items = news.data?.items ?? [];
  const source = attributionFor(news.data?.sourceAttribution, news.data?.fetchedAt);
  const sourceConfidence = Math.round(source.confidence * 100);
  const sourceHint = t(
    'accountNewsSignal.sourceHint',
    '{{label}} open-web feed checked at {{fetchedAt}} with {{confidence}}% source confidence. Verify before treating it as a Mantu fact.',
    {
      label: source.label,
      fetchedAt: when(source.fetchedAt) || source.fetchedAt,
      confidence: sourceConfidence,
    },
  );

  return (
    <Card>
      <SectionHeader
        title={t('accountNewsSignal.title', 'News & signals')}
        caption={t(
          'accountNewsSignal.caption',
          'Recent public-web news about this account — a free activity signal, not internal project data.',
        )}
        action={<Badge tone="amber">{t('accountNewsSignal.badgeFreeOpenWeb', 'Free · Open web')}</Badge>}
      />
      <div className="p-5">
        {news.isLoading ? (
          <LoadingSkeleton rows={4} />
        ) : news.isError ? (
          <ErrorState
            title={t('accountNewsSignal.errorTitle', 'Could not load news')}
            message={t(
              'accountNewsSignal.errorMessage',
              "The open-web news feed didn't respond. This is a best-effort free signal.",
            )}
            action={
              <Button size="sm" variant="secondary" onClick={() => void news.refetch()}>
                {t('accountNewsSignal.retry', 'Retry')}
              </Button>
            }
          />
        ) : items.length === 0 ? (
          <EmptyState
            title={t('accountNewsSignal.emptyTitle', 'No recent news')}
            message={t(
              'accountNewsSignal.emptyMessage',
              'No public-web headlines matched this account name in the last while.',
            )}
          />
        ) : (
          <>
            <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-[var(--fg-secondary)]">
              <Badge tone="gray">{t('accountNewsSignal.badgeExternal', 'External')}</Badge>
              <SourceBadge
                label={source.label}
                state="crm"
                hint={sourceHint}
                data-testid="account-news-source"
              />
              <SourceBadge
                label={t('accountNewsSignal.confidenceBadge', '{{confidence}}% source confidence', {
                  confidence: sourceConfidence,
                })}
                state={source.confidence >= 0.7 ? 'verified' : 'apollo_stale'}
                hint={sourceHint}
                data-testid="account-news-source-confidence"
              />
              <span>
                {t(
                  'accountNewsSignal.sourceNote',
                  'Open-web signal; verify before treating as a Mantu fact.',
                )}
              </span>
            </div>
            <ul className="space-y-2">
              {items.map((item) => (
                <li
                  key={item.url}
                  className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-card)] p-3"
                >
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm font-medium text-[var(--fg-primary)] hover:text-[var(--brand-primary)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)] rounded-sm"
                  >
                    {item.title}
                  </a>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-[var(--fg-tertiary)]">
                    {item.source ? <span>{item.source}</span> : null}
                    {item.source && item.publishedAt ? <span aria-hidden>·</span> : null}
                    {item.publishedAt ? <span>{when(item.publishedAt)}</span> : null}
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </Card>
  );
}
