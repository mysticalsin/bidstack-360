import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useTableSort } from './useTableSort';

describe('useTableSort', () => {
  it('orders integer micros that collapse to the same JavaScript number', () => {
    // WHY: Number(micros) makes 2^53 and 2^53+1 the same value, so a value
    // column used to leave the larger amount wherever the list already had it.
    const smaller = '9007199254740992';
    const larger = '9007199254740993';
    expect(Number(smaller)).toBe(Number(larger));
    const rows = [
      { id: 'small', micros: smaller },
      { id: 'large', micros: larger },
    ];
    const { result } = renderHook(() =>
      useTableSort(rows, { micros: (row) => BigInt(row.micros) }, { initial: { key: 'micros', dir: 'desc' } }),
    );
    expect(result.current.sorted.map((row) => row.id)).toEqual(['large', 'small']);
  });

  it('still orders ordinary numbers', () => {
    const rows = [
      { id: 'b', n: 2 },
      { id: 'a', n: 10 },
    ];
    const { result } = renderHook(() =>
      useTableSort(rows, { n: (row) => row.n }, { initial: { key: 'n', dir: 'asc' } }),
    );
    expect(result.current.sorted.map((row) => row.id)).toEqual(['b', 'a']);
  });
});
