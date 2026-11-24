// The open sum is numeric text, then compared with the signed int64 maximum.
// Equality is still a real total. One more micros is too large.
import { prisma } from '@bidstack/db';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { INT64_MAX_MICROS, readOpenBook } from './open-book.js';

const ORG = '00000000-0000-4000-8000-000000000001';
const COMPANY = '00000000-0000-4000-8000-000000000002';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('open book int64 boundary', () => {
  it('keeps a total that is exactly the signed int64 maximum', async () => {
    // WHY: `micros > INT64_MAX_MICROS` changed to `>=` marks this total too
    // large. The largest int64 sum is still a real amount, and the tile must
    // not say "too large" for it.
    vi.spyOn(prisma, '$queryRaw').mockResolvedValue([{ n: 1n, total: INT64_MAX_MICROS.toString() }] as never);
    await expect(readOpenBook(ORG, [COMPANY])).resolves.toEqual({
      count: 1,
      micros: INT64_MAX_MICROS,
    });
  });
});
