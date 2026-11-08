import { describe, expect, it } from 'vitest';

import { industryLabel, isHttpUrl, pickFigure, provenanceText } from './index.js';

describe('pickFigure', () => {
  // The product owner's rule: filed > manual with source > Wikidata > Apollo.
  // If the order changes, a provider estimate could hide a filed number.
  it('prefers filed statements over every other source', () => {
    const got = pickFigure([
      { origin: 'provider' as const, v: 1 },
      { origin: 'wikidata' as const, v: 2 },
      { origin: 'manual_sourced' as const, v: 3 },
      { origin: 'filed' as const, v: 4 },
    ]);
    expect(got?.v).toBe(4);
  });

  it('ranks a sourced manual value above Wikidata, and an unsourced one below it', () => {
    expect(pickFigure([{ origin: 'wikidata' as const }, { origin: 'manual_sourced' as const }])?.origin).toBe('manual_sourced');
    expect(pickFigure([{ origin: 'manual' as const }, { origin: 'wikidata' as const }])?.origin).toBe('wikidata');
    expect(pickFigure([{ origin: 'provider' as const }, { origin: 'manual' as const }])?.origin).toBe('manual');
  });

  it('returns null when nothing is known', () => {
    expect(pickFigure([null, undefined, false])).toBeNull();
  });
});

describe('industryLabel', () => {
  // A bare code like "M" rendered as one capital letter on the account page.
  it('maps NACE sections and NAICS sectors to names', () => {
    expect(industryLabel('M')).toBe('Professional, scientific and technical activities');
    expect(industryLabel('j')).toBe('Information and communication');
    expect(industryLabel('54')).toBe('Professional, scientific, and technical services');
  });

  it('never returns a bare one or two character code', () => {
    expect(industryLabel('Z')).toBeNull();
    expect(industryLabel('99')).toBeNull();
    expect(industryLabel('xy')).toBeNull();
    expect(industryLabel('Wikidata industry Q11661')).toBeNull();
  });

  it('keeps full labels and humanises snake case', () => {
    expect(industryLabel('information technology & services')).toBe('Information technology & services');
    expect(industryLabel('financial_services')).toBe('Financial services');
    expect(industryLabel('  ')).toBeNull();
  });
});

describe('isHttpUrl', () => {
  it('accepts http and https only', () => {
    expect(isHttpUrl('https://www.sec.gov/x')).toBe(true);
    expect(isHttpUrl('http://example.com')).toBe(true);
    expect(isHttpUrl('javascript:alert(1)')).toBe(false);
    expect(isHttpUrl('ftp://example.com')).toBe(false);
    expect(isHttpUrl('example.com')).toBe(false);
    expect(isHttpUrl(null)).toBe(false);
  });
});

describe('provenanceText', () => {
  it('joins label and year', () => {
    expect(provenanceText({ label: 'Wikidata', year: '2024' })).toBe('Wikidata · 2024');
    expect(provenanceText({ label: 'Manual', year: null })).toBe('Manual');
  });
});
