// Ported from D:\CRM\packages\ui\src\components\table-pagination.tsx (69 lines).
// Light-rewrite tier (ROUND2-ULTRAPLAN manifest #5): 2 Carbon chevrons → the
// existing BidStack <Icon>, Button variant `contrast` → `primary` (`ghost`
// stays), shadcn's muted-foreground → text-fg-secondary ×2, and every hardcoded
// string ("Previous" / "Next" / "No results" / "Showing … of …") through t()
// with keys in all seven locale trees.
//
// WHY the Intl formatter is built from i18n.language instead of the module-
// level `new Intl.NumberFormat()` the CRM used: BidStack ships seven locales,
// and a module-level formatter latches onto whatever the browser default was
// at import time — a French tenant would get "1,234" instead of "1 234", and
// switching language in-session would never re-format.

import { useMemo, type ReactNode } from 'react';

import { useTranslation } from 'react-i18next';

import { Spinner } from '@/components/table-kit/spinner';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';

export function TablePagination({
  page,
  totalPages,
  pageSize,
  total,
  onPageChange,
  loading = false,
  meta,
}: {
  page: number;
  totalPages: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  loading?: boolean;
  /** Overrides the "Showing x–y of z" range readout (e.g. a selection count). */
  meta?: ReactNode;
}) {
  const { t, i18n } = useTranslation('common');
  const numberFormat = useMemo(() => new Intl.NumberFormat(i18n.language), [i18n.language]);

  const rangeStart = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const rangeEnd = Math.min(page * pageSize, total);

  return (
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-3">
      {/* aria-live so a page change announces the new range to screen readers —
          the row swap itself is silent. */}
      <span
        className="flex items-center gap-2 text-fg-secondary text-xs tabular-nums"
        aria-live="polite"
      >
        {loading && <Spinner />}
        {meta ??
          (total === 0
            ? t('tableKit.pagination.noResults', 'No results')
            : t('tableKit.pagination.range', 'Showing {{start}}–{{end}} of {{total}}', {
                start: numberFormat.format(rangeStart),
                end: numberFormat.format(rangeEnd),
                total: numberFormat.format(total),
              }))}
      </span>
      {totalPages > 1 && (
        <nav
          className="flex items-center gap-2"
          aria-label={t('tableKit.pagination.ariaLabel', 'Pagination')}
        >
          <Button
            variant="ghost"
            size="sm"
            disabled={page <= 1}
            onClick={() => onPageChange(Math.max(1, page - 1))}
          >
            {/* BidStack's Icon set has no `chevron-left`, so the right chevron
                is rotated rather than adding a glyph (Icon.tsx is another
                track's file). The rotation also fixes the hover motion for
                free: Tailwind v4's `rotate-180` sets the independent `rotate`
                property, which composes AFTER the `transform` the icon-motion
                CSS sets, so this glyph's inherited `nudge-right` reads as a
                nudge to the left — the direction "Previous" should move. */}
            <Icon name="chevron-right" size={14} className="rotate-180" />
            {t('tableKit.pagination.previous', 'Previous')}
          </Button>
          <span className="text-fg-secondary text-xs tabular-nums">
            {t('tableKit.pagination.pageOf', '{{page}} / {{totalPages}}', {
              page: numberFormat.format(page),
              totalPages: numberFormat.format(totalPages),
            })}
          </span>
          <Button
            variant="primary"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => onPageChange(page + 1)}
          >
            {t('tableKit.pagination.next', 'Next')}
            <Icon name="chevron-right" size={14} />
          </Button>
        </nav>
      )}
    </div>
  );
}
