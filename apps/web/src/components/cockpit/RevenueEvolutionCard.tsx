import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  compareMicros,
  formatExactUnspecified,
  microsSharePercent,
  UNSPECIFIED_CURRENCY_BASIS,
} from '@/components/dashboard/unspecified-currency';
import { Card, SectionHeader } from '@/components/ui/Card';
import { useFeatureFlags } from '@/hooks/useFeatureFlags';

import type { AccountCockpitSnapshot } from '@bidstack/shared';

interface Props {
  cockpit: AccountCockpitSnapshot;
}

/**
 * Revenue evolution with this client (M3). Data source: ABC via API.
 * Renders ONLY when SHOW_REVENUE_BLOCK is on AND the API delivered points —
 * the brief forbids empty/null placeholder states for unavailable sources.
 */
export const RevenueEvolutionCard = memo(function RevenueEvolutionCard({ cockpit }: Props) {
  const flags = useFeatureFlags();
  const { t } = useTranslation('crm');
  const points = cockpit.revenueEvolution ?? [];
  if (!flags.showRevenueBlock || points.length === 0) return null;

  const max = points.reduce<string>(
    (largest, point) => (compareMicros(point.revenueMicros, largest) > 0 ? point.revenueMicros : largest),
    '0',
  );
  const peak = points.reduce(
    (best, point) => (compareMicros(point.revenueMicros, best.revenueMicros) > 0 ? point : best),
    points[0]!,
  );
  return (
    <Card role="region" aria-label={t('revenueEvolution.regionLabel', 'Revenue evolution')}>
      <SectionHeader
        title={t('revenueEvolution.title', 'Revenue evolution')}
        caption={t(
          'revenueEvolution.caption',
          'Won-deal amounts by month on this account. {{basis}}',
          { basis: UNSPECIFIED_CURRENCY_BASIS },
        )}
      />
      <p className="sr-only">
        {t('revenueEvolution.srSummary', '{{count}} months of won-deal revenue. Peak {{period}}.', {
          count: points.length,
          period: peak.period,
        })}
      </p>
      <ul
        className="flex items-end gap-2 px-5 pb-5"
        style={{ minHeight: 120 }}
        aria-label={t('revenueEvolution.barsListLabel', 'Won-deal revenue by month')}
      >
        {points.map((p) => (
          <RevenueBar key={p.period} period={p.period} micros={p.revenueMicros} max={max} />
        ))}
      </ul>
    </Card>
  );
});

function RevenueBar({
  period,
  micros,
  max,
}: {
  period: string;
  micros: string;
  max: string;
}) {
  const { t } = useTranslation('crm');
  const formatted = formatExactUnspecified(micros);
  const share = microsSharePercent(micros, max);
  const height = share <= 0 ? 0 : Math.max(6, (share / 100) * 96);
  return (
    <li
      className="flex flex-1 flex-col items-center gap-1"
      aria-label={t('revenueEvolution.barLabel', '{{period}}: {{amount}}', { period, amount: formatted })}
    >
      <div
        className="w-full rounded-t bg-[var(--brand-primary)]"
        style={{ height: `${height}px` }}
        aria-hidden
      />
      <span className="text-[11px] text-[var(--fg-tertiary)]">{period}</span>
    </li>
  );
}
