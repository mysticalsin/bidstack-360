/**
 * SalesToolkitsPage — industry-tagged Mantu Academy (360Learning) courses,
 * pulled live (never stored locally). Managers use these to build
 * sector-specific pitch decks. Cards open the course in a new tab.
 */
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { EmptyState, ErrorState, LoadingSkeleton } from '@/components/ui/StateMessages';
import { useSalesToolkits } from '@/hooks/useSalesToolkits';

export default function SalesToolkitsPage() {
  const { t } = useTranslation('crm');
  const [sector, setSector] = useState('');
  const toolkits = useSalesToolkits(sector || undefined);

  const sectors = useMemo(() => {
    const tags = new Set<string>();
    for (const course of toolkits.data?.items ?? []) {
      for (const tag of course.sectorTags) tags.add(tag);
    }
    return [...tags].sort();
  }, [toolkits.data?.items]);

  return (
    <div className="space-y-5">
      <div className="page-head">
        <div>
          <h1 className="page-title">{t('salesToolkits.pageTitle', 'Sales Toolkits')}</h1>
          <div className="page-sub">
            {t(
              'salesToolkits.pageSubtitle',
              'Industry playbooks and courses from Mantu Academy — pulled live, filtered by sector.',
            )}
          </div>
        </div>
      </div>

      {toolkits.isLoading ? (
        <LoadingSkeleton rows={6} />
      ) : toolkits.isError ? (
        <ErrorState
          title={t('salesToolkits.errorTitle', 'Mantu Academy is unreachable')}
          message={
            toolkits.error?.message ??
            t('salesToolkits.errorMessage', 'The LMS did not respond. Try again shortly.')
          }
        />
      ) : toolkits.data && toolkits.data.items.length === 0 ? (
        <EmptyState
          title={
            sector
              ? t('salesToolkits.emptyFilteredTitle', 'No courses tagged "{{sector}}"', { sector })
              : t('salesToolkits.emptyTitle', 'No courses published yet')
          }
          message={t(
            'salesToolkits.emptyMessage',
            'Courses appear here as soon as Mantu Academy publishes them with sector tags.',
          )}
        />
      ) : (
        <>
          {toolkits.data?.preview ? <SampleBanner /> : null}
          {/* Announce the filtered result count to assistive tech when a sector chip changes. */}
          <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
            {sector
              ? t('salesToolkits.resultCountInSector', '{{count}} course in {{sector}}', {
                  count: toolkits.data?.items.length ?? 0,
                  sector,
                })
              : t('salesToolkits.resultCount', '{{count}} course', {
                  count: toolkits.data?.items.length ?? 0,
                })}
          </p>
          {sectors.length > 0 ? (
            <div
              className="flex flex-wrap items-center gap-2"
              role="group"
              aria-label={t('salesToolkits.filterGroupLabel', 'Filter by sector')}
            >
              <SectorChip
                label={t('salesToolkits.allSectors', 'All sectors')}
                active={sector === ''}
                onClick={() => setSector('')}
              />
              {sectors.map((tag) => (
                <SectorChip
                  key={tag}
                  label={tag}
                  active={sector === tag}
                  onClick={() => setSector(tag)}
                />
              ))}
            </div>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {(toolkits.data?.items ?? []).map((course) => (
              <Card key={course.id} className="flex flex-col">
                <div className="flex-1 p-5">
                  <div className="mb-2 flex flex-wrap gap-1.5">
                    {course.sectorTags.slice(0, 3).map((tag) => (
                      <Badge key={tag} tone="blue">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                  <h2 className="text-sm font-semibold text-[var(--fg-primary)]">{course.title}</h2>
                  {course.description ? (
                    <p className="mt-1 line-clamp-3 text-xs text-[var(--fg-tertiary)]">
                      {course.description}
                    </p>
                  ) : null}
                </div>
                {course.url ? (
                  <a
                    href={course.url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex min-h-[44px] items-center justify-between border-t border-[var(--border)] px-5 text-xs font-medium text-[var(--brand-primary)] hover:bg-[var(--surface-sunken)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--brand-primary)]"
                  >
                    {t('salesToolkits.openInAcademy', 'Open in Mantu Academy')}
                    <Icon name="arrow-up-right" size={14} aria-hidden />
                  </a>
                ) : null}
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function SectorChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`min-h-[44px] rounded-full border px-3 text-xs font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--brand-primary)] ${
        active
          ? 'border-[var(--brand-primary)] bg-[var(--brand-primary-tint)] text-[var(--brand-primary)]'
          : 'border-[var(--border)] text-[var(--fg-secondary)] hover:border-[var(--fg-tertiary)]'
      }`}
    >
      {label}
    </button>
  );
}

function SampleBanner() {
  const { t } = useTranslation('crm');
  return (
    <div
      role="status"
      className="flex items-start gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface-sunken)] p-3 text-sm text-[var(--fg-primary)]"
    >
      <Icon name="info" size={16} aria-hidden />
      <div>
        <strong className="font-semibold">{t('salesToolkits.sampleDataLabel', 'Sample data.')}</strong>{' '}
        {t('salesToolkits.sampleDataIntro', 'These are illustrative toolkits. Set')}{' '}
        <code className="text-xs">LMS_360L_ENABLED</code>{' '}
        {t(
          'salesToolkits.sampleDataOutro',
          '+ credentials to pull live courses from Mantu Academy.',
        )}
      </div>
    </div>
  );
}
