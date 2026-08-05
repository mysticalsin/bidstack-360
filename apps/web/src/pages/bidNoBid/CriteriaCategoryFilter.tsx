// The four category rings, retired into one segmented filter row.
//
// ScoreSummaryStrip spent ~120px of vertical space on four ProgressRings that
// only reported a number. Here the same four numbers ride on the controls that
// slice the table, so the readout and the filter are one object instead of two.
// The leftmost segment is the whole matrix, and carries the composite — every
// number in the row is therefore the same unit (0–100), which is what lets them
// be compared at a glance.
//
// No colour: the rings were tinted per category (brand / info / success /
// warning), which put four semantic colours on screen to encode nothing more
// than "these are different categories". Difference is carried by the words.

import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/cn';
import { ALL_SEGMENT } from '@/lib/table/list-search-params';

import { CRITERIA_CATEGORIES } from './bid-no-bid-search-params';
import { CATEGORY_INFO } from './bidNoBidTypes';

const SEGMENT =
  'inline-flex h-8 items-center gap-2 rounded-md border px-2.5 text-xs transition-colors';
const SEGMENT_ACTIVE = 'border-border-strong bg-surface-sunken text-fg-primary';
const SEGMENT_IDLE =
  'border-border-subtle text-fg-secondary hover:border-border-default hover:text-fg-primary';

function Segment({
  active,
  ariaLabel,
  label,
  score,
  onClick,
}: {
  active: boolean;
  ariaLabel: string;
  label: string;
  score: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={ariaLabel}
      className={cn(SEGMENT, active ? SEGMENT_ACTIVE : SEGMENT_IDLE)}
    >
      <span>{label}</span>
      <span className="tabular-nums text-fg-tertiary">{score}</span>
    </button>
  );
}

export function CriteriaCategoryFilter({
  value,
  onChange,
  totalScore,
  categoryScores,
}: {
  value: string;
  onChange: (next: string) => void;
  totalScore: number;
  categoryScores: Record<string, number>;
}) {
  const { t } = useTranslation('crm');

  return (
    <div
      role="group"
      aria-label={t('bidNoBid.filter.aria', 'Filter criteria by category')}
      className="mb-3 flex flex-wrap items-center gap-1.5"
    >
      <Segment
        active={value === ALL_SEGMENT}
        onClick={() => onChange(ALL_SEGMENT)}
        label={t('bidNoBid.filter.all', 'All criteria')}
        score={totalScore}
        ariaLabel={t('bidNoBid.filter.allAria', 'All criteria, composite score {{score}} of 100', {
          score: totalScore,
        })}
      />
      {CRITERIA_CATEGORIES.map((category) => {
        // The English constant stays the fallback so the key can be added to the
        // seven locale trees without this row ever rendering blank.
        const label = t(`bidNoBid.category.${category}`, CATEGORY_INFO[category]?.label ?? category);
        const score = categoryScores[category] ?? 0;
        return (
          <Segment
            key={category}
            active={value === category}
            onClick={() => onChange(category)}
            label={label}
            score={score}
            ariaLabel={t(
              'bidNoBid.filter.categoryAria',
              '{{category}}, category score {{score}} of 100',
              { category: label, score },
            )}
          />
        );
      })}
    </div>
  );
}
