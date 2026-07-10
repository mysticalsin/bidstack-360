import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  canonicalPaletteId,
  clearPaletteFrecency,
  frecencyBoost,
  frecencyScoreOf,
  getFrecencyScores,
  recencyWeight,
  recordPaletteSelection,
} from './paletteFrecency';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

beforeEach(() => {
  clearPaletteFrecency();
});

afterEach(() => {
  clearPaletteFrecency();
});

describe('recencyWeight', () => {
  it('decays strictly across the recency buckets', () => {
    // WHY: the whole point of frecency over a plain counter — a selection
    // from this hour must matter more than one from last month, or stale
    // habits pin the ranking forever.
    const weights = [
      recencyWeight(HOUR / 2),
      recencyWeight(2 * HOUR),
      recencyWeight(2 * DAY),
      recencyWeight(10 * DAY),
      recencyWeight(90 * DAY),
    ];
    for (let i = 1; i < weights.length; i++) {
      expect(weights[i]!).toBeLessThan(weights[i - 1]!);
    }
    expect(weights[weights.length - 1]).toBeGreaterThan(0);
  });
});

describe('frecencyScoreOf', () => {
  it('sums bucket weights and caps the number of counted stamps', () => {
    const now = Date.now();
    const fresh = new Date(now - 5 * 60_000).toISOString();
    // 20 rapid selections must not score higher than the per-id stamp cap
    // allows — otherwise one spam-clicked row dominates every ranking.
    const spammed = Array.from({ length: 20 }, () => fresh);
    expect(frecencyScoreOf(spammed, now)).toBe(8 * 100);
    expect(frecencyScoreOf([fresh], now)).toBe(100);
  });

  it('ignores malformed timestamps instead of poisoning the score', () => {
    const now = Date.now();
    expect(frecencyScoreOf(['not-a-date'], now)).toBe(0);
  });
});

describe('frecencyBoost', () => {
  it('is zero without history, grows with score, and caps at 12', () => {
    // WHY the cap: frecency reorders near-peers; it must never bury a much
    // better text match (paletteFuzzy word-start bonus is 8, prefix 10).
    expect(frecencyBoost(0)).toBe(0);
    expect(frecencyBoost(100)).toBeGreaterThan(0);
    expect(frecencyBoost(100)).toBeLessThan(frecencyBoost(200));
    expect(frecencyBoost(1_000_000)).toBe(12);
  });
});

describe('recordPaletteSelection / getFrecencyScores', () => {
  it('round-trips selections through localStorage', () => {
    recordPaletteSelection('account:acme');
    recordPaletteSelection('account:acme');
    recordPaletteSelection('task:t1');

    const scores = getFrecencyScores();
    expect(scores.get('account:acme')!).toBeGreaterThan(scores.get('task:t1')!);
  });

  it('evicts the weakest ids beyond the cap but never the id just selected', () => {
    // WHY: unbounded growth would make every palette open parse an ever-
    // larger blob; the just-selected id must survive eviction ties or the
    // newest habit is the first thing forgotten.
    const now = Date.now();
    for (let i = 0; i < 45; i++) {
      recordPaletteSelection(`account:co_${i}`, now - (45 - i) * 1000);
    }
    const scores = getFrecencyScores(now);
    expect(scores.size).toBeLessThanOrEqual(40);
    expect(scores.has('account:co_44')).toBe(true);
  });

  it('returns an empty map when localStorage holds corrupted JSON', () => {
    window.localStorage.setItem('bidstack.palette.frecency.v1', '{not json');
    expect(getFrecencyScores().size).toBe(0);
    // And recording on top of corruption must recover, not throw.
    recordPaletteSelection('account:acme');
    expect(getFrecencyScores().has('account:acme')).toBe(true);
  });
});

describe('canonicalPaletteId', () => {
  it('collapses every alias of a destination onto one identity', () => {
    // WHY: recents/search echoes mint different ids for the same record;
    // without canonicalization repeat use splits across aliases and no row
    // ever builds a meaningful boost.
    expect(canonicalPaletteId('recent:account:x')).toBe('account:x');
    expect(canonicalPaletteId('recent-account:x')).toBe('account:x');
    expect(canonicalPaletteId('recent:nav:/dashboard')).toBe('nav:/dashboard');
    expect(canonicalPaletteId('search:opportunity:o1')).toBe('opp:o1');
    expect(canonicalPaletteId('search:company:x')).toBe('account:x');
    expect(canonicalPaletteId('search:contact:c1')).toBe('contact:c1');
    expect(canonicalPaletteId('account:x')).toBe('account:x');
  });
});
