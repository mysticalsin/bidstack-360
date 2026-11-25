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
 * The revenue aggregate keys months as YYYY-MM. A bid lead reads "Sep 2026",
 * not the key. Anything that is not a calendar month stays as sent.
 */
export function revenueMonthCaption(period: string, locale: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(period);
  if (!match) return period;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return period;
  return new Intl.DateTimeFormat(locale || 'en', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, month - 1, 1)));
}

/**
 * Revenue evolution with this client (M3). Data source: ABC via API.
 * Renders ONLY when SHOW_REVENUE_BLOCK is on AND the API delivered points —
 * the brief forbids empty/null placeholder states for unavailable sources.
 */
export const RevenueEvolutionCard = memo(function RevenueEvolutionCard({ cockpit }: Props) {
  const flags = useFeatureFlags();
  const { t, i18n } = useTranslation('crm');
  const points = cockpit.revenueEvolution ?? [];
  if (!flags.showRevenueBlock || points.length === 0) return null;

  const max = Math.max(...points.map((p) => p.revenueMicros), 1);
  const peak = points.reduce((a, b) => (b.revenueMicros > a.revenueMicros ? b : a), points[0]!);
  const peakLabel = revenueMonthCaption(peak.period, i18n.language);
  return (
    <Card role="region" aria-label={t('revenueEvolution.regionLabel', 'Revenue evolution')}>
      <SectionHeader
        title={t('revenueEvolution.title', 'Revenue evolution')}
        caption={t('revenueEvolution.caption', 'Won-deal revenue with this client by month')}
      />
      <p className="sr-only">
        {t('revenueEvolution.srSummary', '{{count}} months of won-deal revenue. Peak {{period}}.', {
          count: points.length,
          period: peakLabel,
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
  const { t, i18n } = useTranslation('crm');
  const formatted = useDisplayMoneyMicros(micros, 'EUR', { compact: true });
  const periodLabel = revenueMonthCaption(period, i18n.language);
  return (
    <li
      className="flex flex-1 flex-col items-center gap-1"
      aria-label={t('revenueEvolution.barLabel', '{{period}}: {{amount}}', {
        period: periodLabel,
        amount: formatted,
      })}
    >
      <span className="whitespace-nowrap text-xs font-medium tabular-nums text-[var(--fg-primary)]">
        {formatted}
      </span>
      <div
        className="w-full rounded-t bg-[var(--brand-primary)]"
        style={{ height: `${Math.max(6, (micros / max) * 96)}px` }}
        aria-hidden
      />
      <span className="whitespace-nowrap text-[11px] text-[var(--fg-tertiary)]">{periodLabel}</span>
    </li>
  );
}
