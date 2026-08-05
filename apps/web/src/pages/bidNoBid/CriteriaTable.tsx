// The ten weighted criteria as one dense table — ROUND2-ULTRAPLAN's density
// retarget for this surface: "criteria/scoring rows as SimpleTable with
// ROW_ACCENT". It replaces the md:grid-cols-2 card grid, which spent a full
// viewport on five of the ten criteria.
//
// ── WHAT EACH ROW NOW SHOWS THAT THE CARD DID NOT ───────────────────────────
// The card carried label, description, weight and the 1–5 control. The row adds
// the two numbers a reviewer actually argues about: the rating in words, and
// the WEIGHTED POINTS the criterion contributes to the composite — so the
// question "what is dragging this bid down?" is answered by sorting a column
// instead of doing ten multiplications in your head.
//
// ── COLOUR DISCIPLINE ───────────────────────────────────────────────────────
// Zero colour in the body. The selected rating is a neutral high-contrast fill,
// not a semantic one: the old card painted 5 in brand blue and 1 in danger red,
// which put ten coloured blocks and one brand accent on screen at once. Rating
// severity is carried by the digit, the word and the points — three honest
// signals — and the brand accent is spent once, on Save.

import { useTranslation } from 'react-i18next';

import { EmptyCellValue } from '@/components/table-kit/empty-cell';
import {
  SimpleTable,
  SimpleTableRow,
  type SimpleTableColumn,
} from '@/components/table-kit/simple-table';
import { TableCell } from '@/components/table-kit/table';
import { cn } from '@/lib/cn';
import { ROW_ACCENT } from '@/lib/table/row-accent';

import type { CriteriaSortId } from './bid-no-bid-search-params';
import {
  CATEGORY_SHORT_LABEL,
  RATING_LABEL,
  RATING_VALUES,
  contributionOf,
  type Criterion,
  type ScoreValue,
  type Scores,
} from './bidNoBidTypes';

// ROW_ACCENT ships `cursor-pointer` because every accented row in the source
// CRM is a navigation target. These rows are not: the 2px rail is a reading
// ruler across six columns on a screen where the interaction lives INSIDE the
// row. twMerge resolves the two cursor utilities to the later one.
const ROW_RULE = cn(ROW_ACCENT, 'cursor-default');

const COLUMN_COUNT = 6;

type SortProps = {
  sort: string;
  dir: 'asc' | 'desc';
  onToggleSort: (id: string) => void;
};

function SortHeader({
  id,
  label,
  sort,
  dir,
  onToggleSort,
}: SortProps & { id: CriteriaSortId; label: string }) {
  const { t } = useTranslation('crm');
  const active = sort === id;

  // SimpleTable renders plain <th>s and exposes no per-column aria-sort hook,
  // so the sort state travels in the button's accessible name instead — the
  // control still announces what it will do and what it already did.
  const ariaLabel = !active
    ? t('bidNoBid.table.sortBy', 'Sort by {{column}}.', { column: label })
    : dir === 'asc'
      ? t('bidNoBid.table.sortedAsc', '{{column}}, sorted ascending. Activate to sort descending.', {
          column: label,
        })
      : t(
          'bidNoBid.table.sortedDesc',
          '{{column}}, sorted descending. Activate to sort ascending.',
          { column: label },
        );

  return (
    <button
      type="button"
      onClick={() => onToggleSort(id)}
      aria-label={ariaLabel}
      className="inline-flex items-center gap-1 rounded-sm text-fg-secondary transition-colors hover:text-fg-primary"
    >
      <span>{label}</span>
      {/* Reserved, never removed: a caret that appears on sort would shift the
          header row by a character every time a column is clicked. */}
      <span aria-hidden className={cn('text-fg-muted', !active && 'opacity-0')}>
        {dir === 'asc' ? '↑' : '↓'}
      </span>
    </button>
  );
}

function ScoreButtons({
  criterion,
  score,
  onScore,
}: {
  criterion: Criterion;
  score: ScoreValue;
  onScore: (criterionId: string, value: ScoreValue) => void;
}) {
  const { t } = useTranslation('crm');
  return (
    <div className="flex items-center gap-1">
      {RATING_VALUES.map((value) => {
        const selected = score === value;
        return (
          <button
            key={value}
            type="button"
            // Clicking the current rating clears it — the only way back to
            // "unrated" once a row has been touched.
            onClick={() => onScore(criterion.id, selected ? 0 : value)}
            aria-pressed={selected}
            aria-label={`${criterion.label}: ${t(RATING_LABEL[value].key, RATING_LABEL[value].fallback)}`}
            className={cn(
              'size-6 rounded-sm border text-[11px] font-medium tabular-nums transition-colors',
              selected
                ? 'border-fg-primary bg-fg-primary text-fg-inverted'
                : 'border-border-subtle text-fg-secondary hover:border-border-strong hover:text-fg-primary',
            )}
          >
            {value}
          </button>
        );
      })}
    </div>
  );
}

function CriterionRow({
  criterion,
  score,
  onScore,
}: {
  criterion: Criterion;
  score: ScoreValue;
  onScore: (criterionId: string, value: ScoreValue) => void;
}) {
  const { t } = useTranslation('crm');
  const points = contributionOf(criterion, score);

  return (
    <SimpleTableRow className={ROW_RULE} data-testid="criterion-row">
      <TableCell className="whitespace-normal">
        <span className="block font-medium text-fg-primary">{criterion.label}</span>
        <span className="mt-0.5 line-clamp-2 block text-fg-secondary">{criterion.description}</span>
      </TableCell>
      <TableCell className="text-fg-secondary">
        {t(
          CATEGORY_SHORT_LABEL[criterion.category].key,
          CATEGORY_SHORT_LABEL[criterion.category].fallback,
        )}
      </TableCell>
      <TableCell className="text-right tabular-nums text-fg-secondary">{criterion.weight}</TableCell>
      <TableCell>
        <ScoreButtons criterion={criterion} score={score} onScore={onScore} />
      </TableCell>
      <TableCell className="text-fg-secondary">
        {score > 0 ? t(RATING_LABEL[score].key, RATING_LABEL[score].fallback) : <EmptyCellValue />}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {score > 0 ? points.toFixed(1) : <EmptyCellValue />}
      </TableCell>
    </SimpleTableRow>
  );
}

type ColumnLabels = Record<
  'criterion' | 'category' | 'weight' | 'score' | 'rating' | 'contribution',
  string
>;

function buildColumns(sortProps: SortProps, labels: ColumnLabels): SimpleTableColumn[] {
  return [
    {
      header: <SortHeader id="criterion" label={labels.criterion} {...sortProps} />,
      width: 'w-2/5',
    },
    { header: labels.category, width: 'w-28' },
    {
      header: <SortHeader id="weight" label={labels.weight} {...sortProps} />,
      width: 'w-20',
      align: 'right',
    },
    {
      header: <SortHeader id="score" label={labels.score} {...sortProps} />,
      width: 'w-44',
    },
    { header: labels.rating, width: 'w-28' },
    {
      header: <SortHeader id="contribution" label={labels.contribution} {...sortProps} />,
      width: 'w-24',
      align: 'right',
    },
  ];
}

export function CriteriaTable({
  criteria,
  scores,
  onScore,
  sort,
  dir,
  onToggleSort,
}: SortProps & {
  criteria: readonly Criterion[];
  scores: Scores;
  onScore: (criterionId: string, value: ScoreValue) => void;
}) {
  const { t } = useTranslation('crm');
  const sortProps: SortProps = { sort, dir, onToggleSort };
  const labels: ColumnLabels = {
    criterion: t('bidNoBid.table.criterion', 'Criterion'),
    category: t('bidNoBid.table.category', 'Category'),
    weight: t('bidNoBid.table.weight', 'Weight'),
    score: t('bidNoBid.table.score', 'Score'),
    rating: t('bidNoBid.table.rating', 'Rating'),
    contribution: t('bidNoBid.table.contribution', 'Points'),
  };

  // Footer totals describe the VISIBLE rows, so a category filter shows that
  // category's own weight and points rather than a total that does not add up
  // on screen.
  const weight = criteria.reduce((sum, criterion) => sum + criterion.weight, 0);
  const points = criteria.reduce(
    (sum, criterion) => sum + contributionOf(criterion, scores[criterion.id] ?? 0),
    0,
  );

  return (
    // containerClassName, not className: SimpleTable forwards className to the
    // <table> and containerClassName to the bordered wrapper that owns the box.
    <SimpleTable columns={buildColumns(sortProps, labels)} containerClassName="mb-6">
      {criteria.length === 0 ? (
        <SimpleTableRow>
          <TableCell colSpan={COLUMN_COUNT} className="py-6 text-center text-fg-secondary">
            {t('bidNoBid.table.empty', 'No criteria match this filter.')}
          </TableCell>
        </SimpleTableRow>
      ) : (
        <>
          {criteria.map((criterion) => (
            <CriterionRow
              key={criterion.id}
              criterion={criterion}
              score={scores[criterion.id] ?? 0}
              onScore={onScore}
            />
          ))}
          <SimpleTableRow className="border-t border-border-default font-medium">
            <TableCell colSpan={2}>{t('bidNoBid.table.total', 'Weighted total')}</TableCell>
            <TableCell className="text-right tabular-nums">{weight}</TableCell>
            <TableCell colSpan={2} />
            <TableCell className="text-right tabular-nums">{points.toFixed(1)}</TableCell>
          </SimpleTableRow>
        </>
      )}
    </SimpleTable>
  );
}
