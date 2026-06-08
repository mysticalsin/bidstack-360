import { useTranslation } from 'react-i18next';

interface CursorPagerProps {
  currentPage: number;
  hasNext: boolean;
  hasPrevious: boolean;
  isLoading?: boolean;
  itemCount: number;
  label?: string;
  onNext: () => void;
  onPrevious: () => void;
}

export function CursorPager({
  currentPage,
  hasNext,
  hasPrevious,
  isLoading = false,
  itemCount,
  label = 'results',
  onNext,
  onPrevious,
}: CursorPagerProps) {
  const { t } = useTranslation('common');
  const resolvedLabel = label === 'results' ? t('ui.pager.results', 'results') : label;

  return (
    <nav
      className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border-subtle)] px-4 py-3"
      aria-label={t('ui.pager.aria_label', '{{label}} pagination', { label: resolvedLabel })}
    >
      <button
        type="button"
        onClick={onPrevious}
        disabled={!hasPrevious || isLoading}
        className="inline-flex min-h-9 items-center rounded-md border border-[var(--border-subtle)] bg-[var(--surface-card)] px-3 py-1.5 text-xs font-medium text-[var(--fg-secondary)] hover:text-[var(--fg-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 pointer-coarse:min-h-11"
      >
        {t('ui.pager.previous', 'Previous')}
      </button>
      <span className="text-xs text-[var(--fg-secondary)]" role="status" aria-live="polite">
        {t('ui.pager.page', 'Page')} {currentPage} · {itemCount} {resolvedLabel}
        {hasNext ? '+' : ''}
      </span>
      <button
        type="button"
        onClick={onNext}
        disabled={!hasNext || isLoading}
        className="inline-flex min-h-9 items-center rounded-md border border-[var(--border-subtle)] bg-[var(--surface-card)] px-3 py-1.5 text-xs font-medium text-[var(--fg-secondary)] hover:text-[var(--fg-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 pointer-coarse:min-h-11"
      >
        {t('ui.pager.next', 'Next')}
      </button>
    </nav>
  );
}
