import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { Card, SectionHeader } from '@/components/ui/Card';
import { useDisplayMoneyMicros } from '@/hooks/useDisplayMoney';
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

  const max = Math.max(...points.map((p) => p.revenueMicros), 1);
  const peak = points.reduce((a, b) => (b.revenueMicros > a.revenueMicros ? b : a), points[0]!);
  return (
    <Card role="region" aria-label={t('revenueEvolution.regionLabel', 'Revenue evolution')}>
      <SectionHeader
        title={t('revenueEvolution.title', 'Revenue evolution')}
        caption={t('revenueEvolution.caption', 'Won-deal revenue with this client by month')}
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

function RevenueBar({ period, micros, max }: { period: string; micros: number; max: number }) {
  const { t } = useTranslation('crm');
  const formatted = useDisplayMoneyMicros(micros, 'EUR', { compact: true });
  return (
    <li
      className="flex flex-1 flex-col items-center gap-1"
      aria-label={t('revenueEvolution.barLabel', '{{period}}: {{amount}}', { period, amount: formatted })}
    >
      <div
        className="w-full rounded-t bg-[var(--brand-primary)]"
        style={{ height: `${Math.max(6, (micros / max) * 96)}px` }}
        aria-hidden
      />
      <span className="text-[11px] text-[var(--fg-tertiary)]">{period}</span>
    </li>
  );
}
