import { useTranslation } from 'react-i18next';

import {
  compareMicros,
  formatExactUnspecified,
  microsSharePercent,
  shareBarWidth,
  UNSPECIFIED_CURRENCY_BASIS,
} from '@/components/dashboard/unspecified-currency';
import { formatMicrosAmount } from '@bidstack/shared';
import { Card, SectionHeader } from '@/components/ui/Card';
import { formatStage } from '@/lib/format';

import type { CrmDeal } from '@bidstack/shared';

interface StageBar {
  stage: string;
  count: number;
  amountMicros: string;
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
      const amount = rows.reduce((sum, deal) => sum + BigInt(deal.amountMicros), 0n);
      const amountMicros = amount.toString();
      const codes = new Set(rows.map((deal) => deal.currencyCode).filter((code): code is string => Boolean(code)));
      const label =
        codes.size === 1
          ? `${formatMicrosAmount(amount)} ${[...codes][0]}`
          : formatExactUnspecified(amountMicros);
      return { stage, count: rows.length, amountMicros, label, name: rows[0]?.stageName ?? null };
    })
    .sort((a, b) => compareMicros(b.amountMicros, a.amountMicros));
}

export function AccountStageBars({ deals }: { deals: readonly CrmDeal[] }) {
  const { t } = useTranslation('crm');
  const bars = stageBars(deals);
  const max = bars.reduce<string>(
    (largest, bar) => (compareMicros(bar.amountMicros, largest) > 0 ? bar.amountMicros : largest),
    '0',
  );

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
                  style={{ width: `${shareBarWidth(microsSharePercent(bar.amountMicros, max), 8)}%` }}
                />
              </div>
            </div>
          ))
        )}
      </div>
    </Card>
  );
}
