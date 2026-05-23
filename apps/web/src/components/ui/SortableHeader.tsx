// Apple-style sortable column header. Three states cycle on click:
// unsorted → asc → desc → unsorted. Active column shows a chevron;
// inactive columns hint sortability on hover. Renders as a button inside
// the <th> so it's keyboard-reachable. Pair it with
// `getSortableHeaderAriaSort` on the owning <th>; screen readers expect the
// sort state on the columnheader, not on the nested button.
//
// Pair with `useTableSort` for the state + comparator.

import type { ReactNode } from 'react';

export type SortDir = 'asc' | 'desc' | null;

export interface SortState<K extends string> {
  key: K | null;
  dir: SortDir;
}

export type SortAria = 'ascending' | 'descending' | 'none';

export function getSortableHeaderAriaSort<K extends string>(
  columnKey: K,
  state: SortState<K>,
): SortAria {
  if (state.key !== columnKey) return 'none';
  if (state.dir === 'asc') return 'ascending';
  if (state.dir === 'desc') return 'descending';
  return 'none';
}

interface Props<K extends string> {
  columnKey: K;
  state: SortState<K>;
  onChange: (next: SortState<K>) => void;
  align?: 'left' | 'right';
  children: ReactNode;
}

export function SortableHeader<K extends string>({
  columnKey,
  state,
  onChange,
  align = 'left',
  children,
}: Props<K>) {
  const isActive = state.key === columnKey;
  const dir: SortDir = isActive ? state.dir : null;

  const cycle = () => {
    // unsorted → asc → desc → unsorted, scoped to this column. Clicking a
    // different column always starts at asc so the user's first click is
    // never destructive.
    if (!isActive || dir === null) onChange({ key: columnKey, dir: 'asc' });
    else if (dir === 'asc') onChange({ key: columnKey, dir: 'desc' });
    else onChange({ key: null, dir: null });
  };

  const nextLabel = !isActive || dir === null ? 'ascending' : dir === 'asc' ? 'descending' : 'none';
  const currentLabel = getSortableHeaderAriaSort(columnKey, state);
  const labelText = typeof children === 'string' ? children : String(columnKey);

  return (
    <button
      type="button"
      onClick={cycle}
      aria-label={`Sort by ${labelText}. Current sort: ${currentLabel}. Activate to sort ${nextLabel}.`}
      // Header buttons inherit the th's padding via the parent; here we just
      // need a flex container that aligns chevron + label tightly together.
      className={`group inline-flex w-full items-center gap-1 text-inherit ${
        align === 'right' ? 'justify-end' : 'justify-start'
      }`}
    >
      <span>{children}</span>
      <span
        aria-hidden
        className={`text-[10px] transition-opacity ${
          isActive ? 'opacity-100 text-[var(--brand-primary)]' : 'opacity-0 group-hover:opacity-60'
        }`}
      >
        {dir === 'desc' ? '▾' : '▴'}
      </span>
    </button>
  );
}
