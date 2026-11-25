import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  SEARCH_GUIDANCE,
  SEARCH_PLACEHOLDER,
  SEARCH_TAB_EMPTY_MESSAGE,
  SEARCH_TAB_EMPTY_TITLE,
  isSearchTab,
  paletteGroupLabel,
  paletteGroupTag,
  searchTabLabel,
  searchTypeLabel,
} from './search-result-types';

describe('search result types', () => {
  it('names the bid records search returns and does not name sales orders', () => {
    // WHY: a Siemens search returns the technical proposal, a requirement,
    // and a reference. The page used to print those machine keys and tell
    // people to search sales orders, which the search route does not emit.
    expect(searchTabLabel('proposal')).toBe('Proposals');
    expect(searchTabLabel('rfp_requirement')).toBe('Requirements');
    expect(searchTabLabel('reference')).toBe('References');
    expect(searchTypeLabel('proposal')).toBe('Proposal');
    expect(searchTypeLabel('rfp_requirement')).toBe('Requirement');
    expect(searchTypeLabel('reference')).toBe('Reference');
    expect(searchTypeLabel('sales_order')).toBe('Result');
    expect(isSearchTab('sales_order')).toBe(false);
    expect(isSearchTab('proposal')).toBe(true);
    expect(paletteGroupLabel('proposal')).toBe('Proposals');
    expect(paletteGroupLabel('rfp_requirement')).toBe('Requirements');
    expect(paletteGroupLabel('reference')).toBe('References');
    expect(paletteGroupLabel('opportunity')).toBeNull();
    expect(paletteGroupTag('proposal')).toBe('prop');
    expect(paletteGroupTag('rfp_requirement')).toBe('req');
    expect(paletteGroupTag('reference')).toBe('ref');
    expect(SEARCH_PLACEHOLDER.toLowerCase()).not.toContain('order');
    expect(SEARCH_GUIDANCE.toLowerCase()).not.toContain('order');
    expect(SEARCH_GUIDANCE).toContain('proposals, and references');
    expect(SEARCH_TAB_EMPTY_TITLE).toBe('No {{type}}');
    expect(SEARCH_TAB_EMPTY_MESSAGE).toContain('Other matches are on All');
  });

  it('keeps the English catalog on those words, because the catalog wins over the component default', () => {
    // WHY: t() returns crm.json when the key exists. A stale "sales orders"
    // string in the catalog would still ship after the component default changed.
    const catalog = JSON.parse(
      readFileSync(path.resolve(process.cwd(), 'public/locales/en/crm.json'), 'utf8'),
    ) as {
      search: {
        input: { placeholder: string };
        guidance: { message: string };
        tab: Record<string, string>;
        type: Record<string, string>;
        empty: { tabTitle: string; tabMessage: string };
      };
    };
    expect(catalog.search.input.placeholder).toBe(SEARCH_PLACEHOLDER);
    expect(catalog.search.guidance.message).toBe(SEARCH_GUIDANCE);
    expect(catalog.search.guidance.message.toLowerCase()).not.toContain('order');
    expect(catalog.search.tab.proposal).toBe('Proposals');
    expect(catalog.search.tab.rfp_requirement).toBe('Requirements');
    expect(catalog.search.tab.reference).toBe('References');
    expect(catalog.search.type.proposal).toBe('Proposal');
    expect(catalog.search.type.rfp_requirement).toBe('Requirement');
    expect(catalog.search.type.reference).toBe('Reference');
    expect(catalog.search.empty.tabTitle).toBe(SEARCH_TAB_EMPTY_TITLE);
    expect(catalog.search.empty.tabMessage).toBe(SEARCH_TAB_EMPTY_MESSAGE);
    expect(JSON.stringify(catalog.search).toLowerCase()).not.toContain('sales order');
  });
});
