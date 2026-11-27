import { describe, expect, it } from 'vitest';

import { companyListIsWholeBook } from './company-list-window';

describe('companyListIsWholeBook', () => {
  it('treats the demo book as the whole list when nothing follows the page', () => {
    // Ten seeded companies, no next cursor. "Latest 50" would invent forty
    // companies that were not returned.
    expect(companyListIsWholeBook(10, false)).toBe(true);
    expect(companyListIsWholeBook(1, false)).toBe(true);
    // A full page with no next cursor is still the whole book.
    expect(companyListIsWholeBook(50, false)).toBe(true);
  });

  it('keeps a later page on the window sentence', () => {
    expect(companyListIsWholeBook(50, true)).toBe(false);
    expect(companyListIsWholeBook(2, true)).toBe(false);
  });

  it('does not call an empty read a complete book of zero', () => {
    expect(companyListIsWholeBook(0, false)).toBe(false);
  });
});
