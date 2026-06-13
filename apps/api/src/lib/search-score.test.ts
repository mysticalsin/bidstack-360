import { describe, expect, it } from 'vitest';

import { scoreMatch, tokenize } from './search-score.js';

describe('tokenize', () => {
  it('lowercases, splits on whitespace, de-dupes, drops empties', () => {
    expect(tokenize('  Acme   ACME paris ')).toEqual(['acme', 'paris']);
  });
  it('returns [] for whitespace-only input', () => {
    expect(tokenize('   ')).toEqual([]);
  });
});

describe('scoreMatch', () => {
  const F = (text: string, weight = 1) => ({ text, weight });

  it('ranks exact > prefix > substring on the whole query', () => {
    const exact = scoreMatch('acme', [F('acme', 3)]);
    const prefix = scoreMatch('acme', [F('acme corp', 3)]);
    const substr = scoreMatch('acme', [F('the acme corp', 3)]);
    expect(exact).toBeGreaterThan(prefix);
    expect(prefix).toBeGreaterThan(substr);
  });

  // The core fix: a multi-term query where the terms live in DIFFERENT fields
  // must score > 0 (the old whole-substring scorer returned 0 here).
  it('matches multi-term queries spread across fields', () => {
    const score = scoreMatch('acme paris', [F('Acme Corp', 3), F('Paris, France', 1)]);
    expect(score).toBeGreaterThan(0);
  });

  it('rewards covering more query terms', () => {
    const both = scoreMatch('acme paris', [F('Acme Corp', 3), F('Paris', 1)]);
    const one = scoreMatch('acme paris', [F('Acme Corp', 3), F('London', 1)]);
    expect(both).toBeGreaterThan(one);
  });

  it('weights a match in a primary field above a secondary field', () => {
    const primary = scoreMatch('smith', [F('Smith', 3), F('other', 1)]);
    const secondary = scoreMatch('smith', [F('other', 3), F('smith', 1)]);
    expect(primary).toBeGreaterThan(secondary);
  });

  it('boosts a token at a word start over mid-word', () => {
    const wordStart = scoreMatch('son', [F('son of', 2)]);
    const midWord = scoreMatch('son', [F('jameson', 2)]);
    expect(wordStart).toBeGreaterThan(midWord);
  });

  it('returns 0 when nothing matches and for empty fields', () => {
    expect(scoreMatch('zzz', [F('acme', 3)])).toBe(0);
    expect(scoreMatch('acme', [F('', 3)])).toBe(0);
  });
});
