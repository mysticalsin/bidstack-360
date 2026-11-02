// Tiny sort-state + comparator hook. Keep the sorted array stable across
// re-renders so memoized rows downstream don't re-render on every keystroke.
//
// Per-column accessors let callers sort by computed values (e.g. parsed
// dates) without mutating the row. Null/undefined accessor results sort
// last in both directions — most CRMs do this and users intuitively expect
// "missing" rows to clump at the bottom.

import { useMemo, useState } from 'react';

import type { SortState } from '@/components/ui/SortableHeader';

type Accessor<T> = (row: T) => string | number | null | undefined;

interface Options<K extends string> {
  initial?: SortState<K>;
  /** Controlled state. When supplied, the hook acts as a pure comparator. */
  state?: SortState<K>;
  onChange?: (next: SortState<K>) => void;
}

export function useTableSort<T, K extends string>(
  rows: ReadonlyArray<T>,
  accessors: Record<K, Accessor<T>>,
  options: Options<K> | SortState<K> = {},
) {
  // Backwards compat: the old signature passed `initial` directly. If the
  // 3rd argument looks like a SortState (has `dir`), treat it as initial.
  const opts: Options<K> =
    'dir' in options ? { initial: options as SortState<K> } : (options as Options<K>);
  const initial = opts.initial ?? { key: null, dir: null };
  const [internalState, setInternalState] = useState<SortState<K>>(initial);
  const isControlled = opts.state !== undefined;
  const state = isControlled ? (opts.state as SortState<K>) : internalState;
  const setState = (next: SortState<K>) => {
    if (opts.onChange) opts.onChange(next);
    if (!isControlled) setInternalState(next);
  };

  const sorted = useMemo(() => {
    if (!state.key || !state.dir) return rows;
    const accessor = accessors[state.key];
    if (!accessor) return rows;
    const dirFactor = state.dir === 'asc' ? 1 : -1;
    // toSorted (ES2023) keeps the input immutable so the cache stays clean.
    // Fallback to spread+sort for environments that don't ship it yet —
    // Vitest's node environment is 18+ so we'd be fine, but the spread is
    // cheap and works everywhere.
    const next = [...rows];
    next.sort((a, b) => {
      const va = accessor(a);
      const vb = accessor(b);
      // Nulls / undefineds always last regardless of direction.
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      if (typeof va === 'number' && typeof vb === 'number') {
        return (va - vb) * dirFactor;
      }
      // String compare uses locale rules so accents sort correctly for our
      // EU customer base.
      return String(va).localeCompare(String(vb), undefined, { sensitivity: 'base' }) * dirFactor;
    });
    return next;
  }, [rows, state, accessors]);

  return { state, setState, sorted };
}
