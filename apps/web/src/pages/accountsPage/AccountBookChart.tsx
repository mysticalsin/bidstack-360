import { useReducedMotion } from 'framer-motion';
import { useTranslation } from 'react-i18next';

import { Bar } from '@/components/charts/bar';
import { BarChart } from '@/components/charts/bar-chart';
import { BarYAxis } from '@/components/charts/bar-y-axis';
import { formatUnspecifiedCompactMicros } from '@/components/dashboard/unspecified-currency';
import { stageBarShares } from '@/components/dashboard/widgets/pipeline-headline';

import { ACCOUNT_BOOK_PAGE_CAPTION, openAccountBookStages, type AccountBookDeal } from './accountBookSeries';

/** Open stages on the loaded account page. Closed outcomes stay off the bars. */
export function AccountBookChart({
  deals,
  companyIds,
}: {
  deals: readonly AccountBookDeal[];
  companyIds: ReadonlySet<string>;
}) {
  const { t } = useTranslation('crm');
  const reducedMotion = useReducedMotion();
  const open = openAccountBookStages(deals, companyIds);
  const caption = t('accounts.book.pageCaption', ACCOUNT_BOOK_PAGE_CAPTION);
  const shares = stageBarShares(open);
  const rows = open.map((stage, index) => ({
    stage: stage.label,
    value: shares[index] ?? 0,
    amount: formatUnspecifiedCompactMicros(stage.valueSumMicros),
    count: stage.count,
  }));
  const label = rows.map((stage) => `${stage.stage}, ${stage.amount}, ${stage.count}`).join('. ');

  return (
    <div className="grid gap-2">
      <p className="text-xs text-[var(--fg-secondary)]" data-testid="account-book-caption">
        {caption}
      </p>
      {rows.length === 0 ? (
        <p className="text-sm text-[var(--fg-secondary)]">
          {t('accounts.book.empty', 'No open deals on the loaded page in this view.')}
        </p>
      ) : (
        <div
          className="grid items-stretch gap-2"
          role="img"
          aria-label={label}
          style={{
            gridTemplateColumns: 'minmax(0, 1fr) auto',
            height: Math.max(160, rows.length * 40),
          }}
        >
          <BarChart
            data={rows}
            xDataKey="stage"
            orientation="horizontal"
            aspectRatio="auto"
            className="h-full"
            animationDuration={reducedMotion ? 0 : 450}
            enterTransition={reducedMotion ? { duration: 0 } : { duration: 0.45, ease: [0.2, 0, 0, 1] }}
            margin={{ top: 0, right: 8, bottom: 0, left: 176 }}
            barGap={0.4}
          >
            <Bar
              dataKey="value"
              fill="var(--brand-primary)"
              lineCap="butt"
              fadedOpacity={1}
              animate={!reducedMotion}
            />
            <BarYAxis labelWidth={160} />
          </BarChart>
          <ul
            className="m-0 list-none p-0"
            style={{ display: 'grid', gridTemplateRows: `repeat(${rows.length}, minmax(0, 1fr))` }}
          >
            {rows.map((stage) => (
              <li
                key={stage.stage}
                className="flex items-center justify-end text-xs tabular-nums text-[var(--fg-secondary)]"
              >
                {stage.amount}
                <span className="text-[var(--fg-tertiary)]">
                  {' · '}
                  {stage.count === 1
                    ? t('accounts.book.dealCount_one', '{{count}} deal', { count: stage.count })
                    : t('accounts.book.dealCount_other', '{{count}} deals', { count: stage.count })}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
