// Unit tests for the SavedView Zod contract. These encode WHY the filter bounds
// exist: the value is persisted verbatim and doubled into auditLog.diff on PATCH,
// so an unbounded record/array/string is an authenticated storage-amplification
// vector. The caps must reject oversized payloads while keeping the flat-only
// contract the owning list pages rely on.
import { describe, expect, it } from 'vitest';

import { SavedViewCreate, SavedViewFilters } from './saved-view.js';

describe('SavedViewFilters bounds (storage-amplification guard)', () => {
  it('accepts a normal flat filter record', () => {
    const result = SavedViewFilters.safeParse({
      stage: 'won',
      amountMin: 1000,
      tags: ['enterprise', 'emea'],
      archived: false,
      owner: null,
    });
    expect(result.success).toBe(true);
  });

  it('rejects a record with more than 50 keys', () => {
    const big: Record<string, string> = {};
    for (let i = 0; i < 51; i += 1) big[`k${i}`] = 'v';
    expect(SavedViewFilters.safeParse(big).success).toBe(false);
  });

  it('rejects an over-long string value (> 2000 chars)', () => {
    expect(SavedViewFilters.safeParse({ q: 'x'.repeat(2001) }).success).toBe(false);
  });

  it('rejects an array value with more than 200 items', () => {
    expect(
      SavedViewFilters.safeParse({ ids: Array.from({ length: 201 }, (_, i) => i) }).success,
    ).toBe(false);
  });

  it('still rejects nested objects — the flat-only contract is preserved', () => {
    expect(SavedViewFilters.safeParse({ nested: { a: 1 } }).success).toBe(false);
  });
});

describe('SavedViewCreate', () => {
  it('defaults filters to {} and trims the name', () => {
    const parsed = SavedViewCreate.parse({ entity: 'OPPORTUNITY', name: '  My view  ' });
    expect(parsed.filters).toEqual({});
    expect(parsed.name).toBe('My view');
    expect(parsed.shared).toBe(false);
    expect(parsed.sort).toBeNull();
    expect(parsed.columns).toBeNull();
  });
});
