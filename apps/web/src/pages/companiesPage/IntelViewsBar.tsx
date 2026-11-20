// Saved intel views, direction filter and column visibility for the Companies list.
import { Columns3 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { COMPANY_INTEL_VIEWS, type CompanyIntelView, type IntelDirection } from '@bidstack/shared';

import { Button } from '@/components/ui/Button';

const VIEW_KEYS = Object.keys(COMPANY_INTEL_VIEWS) as CompanyIntelView[];
const DIRECTIONS: Array<{ value: IntelDirection; label: string }> = [
  { value: 'growing', label: 'Growing' },
  { value: 'steady', label: 'Steady' },
  { value: 'contracting', label: 'Contracting' },
];

export interface ColumnOption {
  key: string;
  label: string;
}

export function IntelViewsBar({
  view,
  direction,
  onView,
  onDirection,
  columns,
  isVisible,
  onToggleColumn,
}: {
  view: CompanyIntelView | null;
  direction: IntelDirection | null;
  onView: (v: CompanyIntelView | null) => void;
  onDirection: (d: IntelDirection | null) => void;
  columns: ColumnOption[];
  isVisible: (key: string) => boolean;
  onToggleColumn: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div
        role="group"
        aria-label="Intel views"
        className="inline-flex flex-wrap gap-1 rounded-lg bg-[var(--surface-inset)] p-1"
      >
        {VIEW_KEYS.map((k) => (
          <button
            key={k}
            type="button"
            aria-pressed={view === k}
            onClick={() => onView(view === k ? null : k)}
            className={`rounded-md px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)] ${
              view === k
                ? 'bg-[var(--surface-card)] text-[var(--brand-primary)] shadow-sm'
                : 'text-[var(--fg-secondary)] hover:text-[var(--fg-primary)]'
            }`}
          >
            {COMPANY_INTEL_VIEWS[k].label}
          </button>
        ))}
      </div>
      <label className="sr-only" htmlFor="company-direction">
        Direction
      </label>
      <select
        id="company-direction"
        value={direction ?? ''}
        onChange={(e) => onDirection((e.target.value || null) as IntelDirection | null)}
        className="h-8 rounded-md border border-[var(--border-default)] bg-[var(--surface-card)] px-2 text-xs text-[var(--fg-secondary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)]"
      >
        <option value="">Any direction</option>
        {DIRECTIONS.map((d) => (
          <option key={d.value} value={d.value}>
            {d.label}
          </option>
        ))}
      </select>
      <div ref={wrap} className="relative">
        <Button
          size="sm"
          variant="secondary"
          aria-expanded={open}
          aria-haspopup="true"
          onClick={() => setOpen((o) => !o)}
        >
          <Columns3 className="size-3.5" aria-hidden />
          Columns
        </Button>
        {open && (
          <div
            role="group"
            aria-label="Visible columns"
            className="absolute right-0 z-20 mt-1 w-56 rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] p-2 shadow-lg"
          >
            {columns.map((c) => (
              <label
                key={c.key}
                className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-xs text-[var(--fg-secondary)] hover:bg-[var(--surface-inset)]"
              >
                <input
                  type="checkbox"
                  checked={isVisible(c.key)}
                  onChange={() => onToggleColumn(c.key)}
                  className="accent-[var(--brand-primary)]"
                />
                {c.label}
              </label>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
