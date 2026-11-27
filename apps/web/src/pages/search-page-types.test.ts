import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { SEARCH_PAGE_TYPE_KEYS, searchPageRows, searchPageTab } from './search-page-types';

const LOCALES = ['en', 'fr', 'es', 'it', 'pt', 'zh'] as const;

describe('search page result types', () => {
  it('keeps proposal, requirement, and reference filterable, and leaves sales orders deleted', () => {
    // WHY: global search returns proposal, rfp_requirement, and reference rows.
    // The page tab list stopped at note, so those hits could not be filtered
    // and a `type` link for them did not select a tab. sales_order is still
    // accepted on a stale payload, but the module is gone: it must not become
    // a tab, and a cached row must not be drawn.
    expect(SEARCH_PAGE_TYPE_KEYS).toEqual([
      'opportunity',
      'lead',
      'contact',
      'company',
      'task',
      'note',
      'proposal',
      'rfp_requirement',
      'reference',
    ]);
    expect(SEARCH_PAGE_TYPE_KEYS).not.toContain('sales_order');

    expect(searchPageTab('proposal')).toBe('proposal');
    expect(searchPageTab('rfp_requirement')).toBe('rfp_requirement');
    expect(searchPageTab('reference')).toBe('reference');
    expect(searchPageTab('sales_order')).toBe('all');
    expect(searchPageTab('invoice')).toBe('all');
    expect(searchPageTab(null)).toBe('all');
    expect(searchPageTab('')).toBe('all');

    const drawn = searchPageRows([
      { type: 'proposal', id: 'p1' },
      { type: 'sales_order', id: 'so1' },
      { type: 'reference', id: 'r1' },
    ]);
    expect(drawn.map((row) => row.id)).toEqual(['p1', 'r1']);
    expect(searchPageRows(undefined)).toEqual([]);
  });

  it('does not advertise the deleted sales-order module in the search copy', () => {
    // WHY: the empty state and the input placeholder are the instructions
    // the user reads before any result exists. Leaving "orders" there sends
    // them after a module that stays deleted.
    const pageSrc = readFileSync(path.resolve(process.cwd(), 'src/pages/SearchPage.tsx'), 'utf8');
    const page = pageSrc.slice(pageSrc.indexOf('export function SearchPage'));
    expect(page).toContain('searchPageRows(data?.items)');
    expect(page).toContain('searchPageTab(searchParams.get(\'type\'))');
    expect(page).not.toMatch(/sales orders/i);
    expect(page).not.toMatch(/\borders\b/i);

    const forbidden = /orders|sales order|commandes|pedidos|ordini|订单/i;
    for (const locale of LOCALES) {
      const json = JSON.parse(
        readFileSync(
          path.resolve(process.cwd(), `public/locales/${locale}/crm.json`),
          'utf8',
        ),
      ) as {
        search: {
          input: { placeholder: string };
          guidance: { message: string };
          tab: Record<string, string>;
          type: Record<string, string>;
        };
      };
      expect(json.search.input.placeholder).not.toMatch(forbidden);
      expect(json.search.guidance.message).not.toMatch(forbidden);
      expect(json.search.tab.proposal).toBeTruthy();
      expect(json.search.tab.rfp_requirement).toBeTruthy();
      expect(json.search.tab.reference).toBeTruthy();
      expect(json.search.type.proposal).toBeTruthy();
      expect(json.search.type.rfp_requirement).toBeTruthy();
      expect(json.search.type.reference).toBeTruthy();
      expect(json.search.tab).not.toHaveProperty('sales_order');
    }
  });
});
