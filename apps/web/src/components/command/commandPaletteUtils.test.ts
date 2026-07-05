import { beforeEach, describe, expect, it } from 'vitest';

import type { CrmCompany } from '@bidstack/shared';

import {
  finalizePaletteItems,
  fuzzyMatch,
  matchCompanies,
  rankPaletteItems,
  type Item,
} from './commandPaletteUtils';
import {
  clearPaletteFrecency,
  getFrecencyScores,
  recordPaletteSelection,
} from './paletteFrecency';

// Same minimal-fixture approach as CommandPalette.test.tsx — only the fields
// the matcher reads matter here.
function company(overrides: Partial<CrmCompany>): CrmCompany {
  return {
    id: overrides.id ?? 'co_test',
    source: 'external_crm',
    name: overrides.name ?? 'Test Co',
    legalName: overrides.legalName ?? null,
    domain: overrides.domain ?? null,
    website: null,
    industry: null,
    employeeCount: null,
    annualRevenueMicros: null,
    status: null,
    registryIds: {},
    formerNames: [],
    incorporationDate: null,
    logo: null,
    confidence: 1,
    sourceAttribution: [],
    updatedAt: '2025-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const COMPANIES: CrmCompany[] = [
  company({ id: 'co_aritzia', name: 'Aritzia', domain: 'aritzia.com' }),
  company({ id: 'co_lulu', name: 'Lululemon', domain: 'lululemon.com' }),
  company({ id: 'co_canada-goose', name: 'Canada Goose' }),
];

function item(id: string, label: string, onSelect: () => void = () => {}): Item {
  return { id, group: 'account', label, onSelect };
}

function score(query: string, text: string): number {
  const m = fuzzyMatch(query, text);
  if (!m) throw new Error(`expected "${query}" to match "${text}"`);
  return m.score;
}

beforeEach(() => {
  clearPaletteFrecency();
});

describe('fuzzyMatch', () => {
  it('matches acronyms across word starts ("gtd" → Go to Dashboard)', () => {
    // WHY: the whole point of replacing substring matching — a user can type
    // initials of a multi-word command and still land on it.
    const m = fuzzyMatch('gtd', 'Go to Dashboard');
    expect(m).not.toBeNull();
    expect(m?.indices).toEqual([0, 3, 6]);
  });

  it('scores a word-boundary match above the same fragment mid-word', () => {
    // WHY: "cal" should surface Calendar before anything that merely
    // contains the letters (Physi-cal) — boundary hits are what users mean.
    expect(score('cal', 'Calendar')).toBeGreaterThan(score('cal', 'Physical'));
  });

  it('rejects scattered mid-word subsequences ("ari" must NOT hit Bid/No-Bid Matrix)', () => {
    // WHY: fzf-style any-subsequence would match "ari" via M-a-t-r-i-x,
    // flooding short queries with noise. This also pins the assumption the
    // CommandPalette UI test makes ("ari" yields exactly one row).
    expect(fuzzyMatch('ari', 'Go to Bid/No-Bid Matrix')).toBeNull();
  });

  it('still accepts whole-query mid-word substrings, below anchored matches', () => {
    // WHY: substring matching was the palette's previous contract ("ritz"
    // found Aritzia) — fuzzy must be a superset of it, just ranked lower
    // than a boundary-anchored hit of the same length.
    const midWord = fuzzyMatch('ritz', 'Aritzia');
    expect(midWord?.indices).toEqual([1, 2, 3, 4]);
    expect(score('arit', 'Aritzia')).toBeGreaterThan(score('ritz', 'Aritzia'));
  });

  it('anchors on camelCase boundaries', () => {
    const m = fuzzyMatch('qa', 'quickAdd');
    expect(m?.indices).toEqual([0, 5]);
  });

  it('prefers contiguous matches over gap jumps of equal length', () => {
    // 'ka' is contiguous in "KAM …"; 'ki' jumps a gap to the next word.
    expect(score('ka', 'KAM Initiatives')).toBeGreaterThan(score('ki', 'KAM Initiatives'));
  });

  it('ranks an exact-label match above the same prefix inside a longer label', () => {
    expect(score('tasks', 'Tasks')).toBeGreaterThan(score('tasks', 'Tasks overview'));
  });

  it('returns null for empty queries and non-matches', () => {
    expect(fuzzyMatch('', 'anything')).toBeNull();
    expect(fuzzyMatch('zz', 'abc')).toBeNull();
  });
});

describe('matchCompanies', () => {
  it('filters to fuzzy hits only and sorts best-first', () => {
    // "a" boundary-matches Aritzia (word start) but only mid-word-matches
    // Canada Goose; Lululemon has no "a" anywhere and must disappear.
    const results = matchCompanies(COMPANIES, 'a', 10);
    expect(results.map((r) => r.value.name)).toEqual(['Aritzia', 'Canada Goose']);
  });

  it('caps AFTER sorting so the best hit is never dropped by a weak one', () => {
    // WHY: the old first-N-substring approach could fill the cap with weak
    // hits that appeared earlier in the source list.
    const results = matchCompanies(COMPANIES, 'a', 1);
    expect(results.map((r) => r.value.name)).toEqual(['Aritzia']);
  });

  it('matches on secondary fields (domain), not just the name', () => {
    const results = matchCompanies(COMPANIES, 'aritzia.com', 10);
    expect(results.map((r) => r.value.id)).toEqual(['co_aritzia']);
  });

  it('returns the first N with neutral scores on an empty query (browse mode)', () => {
    const results = matchCompanies(COMPANIES, '', 2);
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.score === 0)).toBe(true);
  });
});

describe('rankPaletteItems', () => {
  it('sorts descending and keeps insertion order on ties (stable)', () => {
    // WHY stability matters: equal-score rows must keep the curated source
    // order (contextual → create → nav → entities) users already know.
    const ranked = rankPaletteItems([
      { item: item('a', 'A'), score: 10 },
      { item: item('b', 'B'), score: 20 },
      { item: item('c', 'C'), score: 10 },
    ]);
    expect(ranked.map((i) => i.id)).toEqual(['b', 'a', 'c']);
  });
});

describe('finalizePaletteItems — frecency integration', () => {
  it('boosts a repeatedly-selected target above an equal text match', () => {
    // WHY: this is the frecency contract — a record the user opens daily
    // must outrank a stranger row with the identical fuzzy score.
    recordPaletteSelection('account:beta');
    recordPaletteSelection('account:beta');

    const ranked = finalizePaletteItems(
      [
        { item: item('account:alpha', 'Alpha Corp'), score: 24 },
        { item: item('account:beta', 'Beta Corp'), score: 24 },
      ],
      'corp',
      getFrecencyScores(),
    );
    expect(ranked.map((i) => i.id)).toEqual(['account:beta', 'account:alpha']);
  });

  it('keeps curated insertion order on an empty query even when scores differ', () => {
    // WHY: the empty palette is a browse surface (recents → create → nav);
    // ranking it would shuffle sections on every open.
    const ranked = finalizePaletteItems(
      [
        { item: item('a', 'A'), score: 1 },
        { item: item('b', 'B'), score: 99 },
      ],
      '',
      getFrecencyScores(),
    );
    expect(ranked.map((i) => i.id)).toEqual(['a', 'b']);
  });

  it('records a selection under the canonical id and still runs the original onSelect', () => {
    let selected = false;
    const [wrapped] = finalizePaletteItems(
      [{ item: item('recent:contact:c1', 'Jane Doe', () => (selected = true)), score: 5 }],
      'jane',
      new Map(),
    );

    wrapped?.onSelect();

    expect(selected).toBe(true);
    // Canonicalized: the recents alias accrues to the same identity a fresh
    // "contact:c1" row would — otherwise frecency splits across aliases.
    expect(getFrecencyScores().get('contact:c1')).toBeGreaterThan(0);
  });

  it('does not double-record nav rows (selectNavTarget owns those)', () => {
    const [wrapped] = finalizePaletteItems(
      [{ item: item('nav:/dashboard', 'Go to Dashboard'), score: 5 }],
      'dash',
      new Map(),
    );

    wrapped?.onSelect();

    // The wrapper must skip nav ids — usePaletteItems' selectNavTarget
    // records them so the Enter-direct-jump path (which bypasses the items
    // list) counts exactly once.
    expect(getFrecencyScores().has('nav:/dashboard')).toBe(false);
  });
});
