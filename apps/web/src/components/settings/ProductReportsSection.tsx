import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';

import { Button } from '@/components/ui/Button';
import { Card, SectionHeader } from '@/components/ui/Card';
import { EmptyState, ErrorState, LoadingSkeleton } from '@/components/ui/StateMessages';
import { api } from '@/lib/api';

interface ProductReport {
  id: string;
  kind: 'bug' | 'feature' | 'crash';
  featureIntent: 'new' | 'improved' | null;
  whatDoing: string;
  steps: string | null;
  page: string;
  createdAt: string;
}

interface ProductReportList {
  items: ProductReport[];
}

export function ProductReportsSection() {
  const { t } = useTranslation('settings');
  const reports = useQuery({
    queryKey: ['product-reports'],
    queryFn: ({ signal }) => api<ProductReportList>('/api/product-reports', { signal }),
  });

  return (
    <Card>
      <SectionHeader
        title={t('productReports.title', 'Product reports')}
        caption={t(
          'productReports.caption',
          'Bugs, feature requests, and crash logs from people in this workspace.',
        )}
      />
      <div className="p-5">
        {reports.isLoading ? (
          <LoadingSkeleton rows={3} />
        ) : reports.isError ? (
          <ErrorState
            title={t('productReports.errorTitle', "Couldn't load reports")}
            message={t(
              'productReports.errorMessage',
              'The rest of Settings is unaffected. This list failed to load.',
            )}
            action={
              <Button size="sm" variant="secondary" onClick={() => void reports.refetch()}>
                {t('productReports.retry', 'Retry')}
              </Button>
            }
          />
        ) : reports.data && reports.data.items.length > 0 ? (
          <ul className="divide-y divide-[var(--border-subtle)]">
            {reports.data.items.map((item) => (
              <li key={item.id} className="py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-xs font-medium uppercase tracking-wide text-[var(--fg-tertiary)]">
                    {labelFor(item, t)}
                  </span>
                  <time className="text-xs text-[var(--fg-tertiary)]" dateTime={item.createdAt}>
                    {formatWhen(item.createdAt)}
                  </time>
                </div>
                <p className="mt-1 text-sm text-[var(--fg-primary)]">{item.whatDoing}</p>
                {item.steps ? (
                  <p className="mt-1 text-xs text-[var(--fg-secondary)]">{item.steps}</p>
                ) : null}
                <p className="mt-1 text-xs text-[var(--fg-tertiary)]">{item.page}</p>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            title={t('productReports.emptyTitle', 'No reports yet')}
            message={t(
              'productReports.emptyMessage',
              'Bugs, feature requests, and crashes from this workspace will show up here.',
            )}
          />
        )}
      </div>
    </Card>
  );
}

function labelFor(item: ProductReport, t: (key: string, defaultValue: string) => string): string {
  if (item.kind === 'bug') return t('productReports.kindBug', 'Bug');
  if (item.kind === 'crash') return t('productReports.kindCrash', 'Crash');
  if (item.featureIntent === 'improved') {
    return t('productReports.kindFeatureImproved', 'Feature · improved');
  }
  return t('productReports.kindFeatureNew', 'Feature · new');
}

function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
    date,
  );
}
