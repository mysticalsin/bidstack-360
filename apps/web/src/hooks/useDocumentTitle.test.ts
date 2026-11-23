import { describe, expect, it } from 'vitest';

import { ADMIN_SETTINGS, NAV_SECTIONS } from '@/components/layout/navConfig';

import { documentTitleForPath } from './useDocumentTitle';

describe('documentTitleForPath', () => {
  it('names every primary rail door so the tab is not the bare product name', () => {
    // Companies stayed "Polo PreSales" after navigation. The title is the
    // WCAG 2.4.2 name of the page; a rail destination that falls through
    // the map is the bug.
    const paths = [
      ...NAV_SECTIONS.flatMap((section) => section.items.map((item) => item.to)),
      ...ADMIN_SETTINGS.map((item) => item.to),
    ];
    for (const path of paths) {
      expect(documentTitleForPath(path), path).not.toBe('Polo PreSales');
    }
  });

  it('keeps a company record on the Companies title', () => {
    expect(documentTitleForPath('/companies/abc')).toBe('Companies · Polo PreSales');
  });

  it('leaves an unknown path on the product name', () => {
    expect(documentTitleForPath('/not-a-page')).toBe('Polo PreSales');
  });
});
