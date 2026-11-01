import { useTranslation } from 'react-i18next';

import { formatUnspecifiedCompact, UNSPECIFIED_CURRENCY_BASIS } from '@/components/dashboard/unspecified-currency';
import { Card, SectionHeader } from '@/components/ui/Card';
import { formatStage } from '@/lib/format';

import type { CrmDeal } from '@bidstack/shared';

interface StageBar {
  stage: string;
  count: number;
  amountMicros: number;
  label: string;
  name: string | null;
}

function barKey(deal: CrmDeal): string {
  return deal.stageName ?? deal.stage;
}

/** One bar per stage on this account. Mixed or missing currency stays unspecified. */
export function stageBars(deals: readonly CrmDeal[]): StageBar[] {
  const grouped = new Map<string, CrmDeal[]>();
  for (const deal of deals) {
    const key = barKey(deal);
    const rows = grouped.get(key) ?? [];
    rows.push(deal);
    grouped.set(key, rows);
  }
  return [...grouped.entries()]
    .map(([stage, rows]) => {
      const amountMicros = rows.reduce((sum, deal) => sum + deal.amountMicros, 0);
      const codes = new Set(rows.map((deal) => deal.currencyCode).filter((code): code is string => Boolean(code)));
      const major = amountMicros / 1_000_000;
      const label =
        codes.size === 1
          ? `${formatUnspecifiedCompact(major).replace(/ unspecified$/, '')} ${[...codes][0]}`
          : formatUnspecifiedCompact(major);
      return { stage, count: rows.length, amountMicros, label, name: rows[0]?.stageName ?? null };
    })
    .sort((a, b) => b.amountMicros - a.amountMicros);
}

export function AccountStageBars({ deals }: { deals: readonly CrmDeal[] }) {
  const { t } = useTranslation('crm');
  const bars = stageBars(deals);
  const max = Math.max(1, ...bars.map((bar) => bar.amountMicros));

  return (
    <Card role="region" aria-label={t('accountStageBars.region', 'This account by stage')}>
      <SectionHeader
        title={t('accountStageBars.title', 'This account')}
        caption={t('accountStageBars.caption', 'Bar length is this account only. {{basis}}', {
          basis: UNSPECIFIED_CURRENCY_BASIS,
        })}
      />
      <div className="flex flex-col gap-2 px-4 pb-4">
        {bars.length === 0 ? (
          <p className="text-sm text-[var(--fg-secondary)]">
            {t('accountStageBars.empty', 'No deals recorded on this account.')}
          </p>
        ) : (
          bars.map((bar) => (
            <div key={bar.stage}>
              <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
                <span className="font-medium text-[var(--fg-primary)]">{bar.name ?? formatStage(bar.stage)}</span>
                <span className="tabular-nums text-xs text-[var(--fg-secondary)]">
                  {t('accountStageBars.meta', '{{count}} · {{amount}}', {
                    count: bar.count,
                    amount: bar.label,
                  })}
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-[var(--surface-sunken)]" aria-hidden>
                <span
                  className="block h-full rounded-full bg-[var(--brand-primary)]"
                  style={{ width: `${Math.max(8, Math.round((bar.amountMicros / max) * 100))}%` }}
                />
              </div>
            </div>
          ))
        )}
      </div>
    </Card>
  );
}
