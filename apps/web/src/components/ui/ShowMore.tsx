import { useId, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { Icon } from '@/components/ui/Icon';
import { cn } from '@/lib/cn';

interface ShowMoreProps {
  children: ReactNode;
  collapsedHeight?: number;
  moreLabel?: string;
  lessLabel?: string;
  className?: string;
  contentClassName?: string;
}

export function ShowMore({
  children,
  collapsedHeight = 144,
  moreLabel,
  lessLabel,
  className,
  contentClassName,
}: ShowMoreProps) {
  const { t } = useTranslation('common');
  const [expanded, setExpanded] = useState(false);
  const contentId = useId();

  const resolvedMoreLabel = moreLabel ?? t('showMore.moreLabel', 'Show more');
  const resolvedLessLabel = lessLabel ?? t('showMore.lessLabel', 'Show less');

  return (
    <div className={cn('space-y-3', className)}>
      <div
        id={contentId}
        className={cn(
          'relative overflow-hidden transition-[max-height] duration-200',
          expanded ? 'max-h-none' : 'max-h-[var(--show-more-height)]',
          contentClassName,
        )}
        style={{ '--show-more-height': `${collapsedHeight}px` } as React.CSSProperties}
      >
        {children}
        {!expanded ? (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-b from-transparent to-[var(--surface-card)]"
          />
        ) : null}
      </div>
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={contentId}
        onClick={() => setExpanded((value) => !value)}
        className="inline-flex min-h-11 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-[var(--brand-primary)] transition-colors hover:bg-[var(--brand-primary-tint)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-page)]"
      >
        <span>{expanded ? resolvedLessLabel : resolvedMoreLabel}</span>
        <Icon name={expanded ? 'caretup' : 'caret'} size={16} className="shrink-0" ariaHidden />
      </button>
    </div>
  );
}
