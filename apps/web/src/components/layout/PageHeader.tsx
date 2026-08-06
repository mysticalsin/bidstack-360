// PageHeader — the one page header.
//
// WHY this exists: 60 files hand-rolled their own <h1>. Counting only the
// obvious variants there were `text-3xl font-semibold`, `text-2xl font-bold`,
// `text-2xl font-semibold`, `text-xl font-semibold`, `text-sm font-semibold`,
// one with `gradient-text`, and 16 more going through the `.page-title` class.
// Seven type treatments for one thing is not a design system, and no token
// change can fix it because the sizes are baked into the call sites.
//
// The treatment itself is docs/DESIGN.md §4/§5: title medium (not bold) at
// text-2xl → text-3xl with tight tracking, description small and muted, actions
// right-aligned on the same row, one hairline underneath. Hierarchy comes from
// size and space; colour is not used to create it.
//
// Migration is deliberately incremental — `.page-title`/`.page-head` keep
// working and now render the same type, so a page can move to this component
// without a coordinated flag day.

import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';

export interface PageHeaderProps {
  /** The page's h1. Usually a string; a node when the record name needs a badge. */
  title: ReactNode;
  /** One line on what this surface is for. Wraps at 68ch so it stays readable. */
  description?: ReactNode;
  /** Primary + secondary actions, right-aligned on the title row. */
  actions?: ReactNode;
  /** Tabs, view switchers or a filter bar — rendered below the title row, above the rule. */
  children?: ReactNode;
  /** Set when the page's main region uses aria-labelledby to point at this title. */
  titleId?: string;
  className?: string;
}

export function PageHeader({
  title,
  description,
  actions,
  children,
  titleId,
  className,
}: PageHeaderProps) {
  return (
    <header className={cn('motion-page-head', className)}>
      <div className="page-head">
        <div className="min-w-0">
          <h1 id={titleId} className="page-title">
            {title}
          </h1>
          {description ? <p className="page-sub">{description}</p> : null}
        </div>
        {/* Absent, not empty: an empty flex box still eats the 24px gap and
            pulls the title off the optical left edge on action-less pages. */}
        {actions ? <div className="page-actions">{actions}</div> : null}
      </div>
      {children}
    </header>
  );
}
