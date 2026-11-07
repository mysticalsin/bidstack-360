import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useTableSort } from './useTableSort';

type Row = { name: string };
const rows: Row[] = [{ name: 'b' }, { name: 'a' }];
const accessors = { name: (r: Row) => r.name };

describe('useTableSort', () => {
  it('keeps the sorted array stable when a controlled caller passes a fresh state object each render', () => {
    // Pages parse ?sort= on every render, so the state object is new each time.
    // A new sorted array per render loops any "reset when items change" logic.
    const { result, rerender } = renderHook(() =>
      useTableSort(rows, accessors, { state: { key: 'name', dir: 'asc' } }),
    );
    const first = result.current.sorted;
    rerender();

    expect(first.map((r) => r.name)).toEqual(['a', 'b']);
    expect(result.current.sorted).toBe(first);
  });
});
