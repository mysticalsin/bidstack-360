// Shared drill-down surface (Tony 15:21: "simple, but we can go in depth").
// Top-level visuals stay few; any number, bar or row opens this sheet with a
// trail back, the full breakdown, filters and the underlying records.
import './drill.css';

import type { ReactNode } from 'react';

import { Sheet, SheetContent } from '@/components/ui/Sheet';

export interface DrillCrumb {
  label: string;
  /** Omit on the current (last) crumb. */
  onSelect?: () => void;
}

export function DrillSheet({
  open, onOpenChange, trail, title, caption, stats, filters, footer, children, testId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trail: DrillCrumb[];
  title: string;
  caption: string;
  stats?: Array<{ label: string; value: ReactNode }>;
  filters?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent size="lg" title={title} description={caption} footer={footer} data-testid={testId}>
        <div className="drill">
          {trail.length > 1 ? (
            <nav aria-label="Drill-down path">
              <ol className="drill-trail">
                {trail.map((c, i) => (
                  <li key={`${c.label}-${i}`}>
                    {c.onSelect && i < trail.length - 1 ? (
                      <button type="button" onClick={c.onSelect}>{c.label}</button>
                    ) : (
                      <span aria-current={i === trail.length - 1 ? 'page' : undefined}>{c.label}</span>
                    )}
                  </li>
                ))}
              </ol>
            </nav>
          ) : null}
          {stats?.length ? (
            <dl className="drill-stats">
              {stats.map((s) => (
                <div key={s.label}><dt>{s.label}</dt><dd>{s.value}</dd></div>
              ))}
            </dl>
          ) : null}
          {filters ? <div className="drill-filters" role="group" aria-label="Filters">{filters}</div> : null}
          {children}
        </div>
      </SheetContent>
    </Sheet>
  );
}
