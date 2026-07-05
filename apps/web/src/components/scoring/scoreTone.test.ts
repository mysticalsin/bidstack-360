/**
 * scoreTone — band mapping + theme-token discipline.
 *
 * WHY these tests exist:
 * 1. The band thresholds ARE the product copy: a lead chip reads "Hot" at ≥60
 *    and an opp chip reads "Likely" at ≥70. If a threshold drifts, reps see a
 *    green "healthy" chip on a deal the model considers at-risk — the mapping
 *    tests pin the exact boundaries (60/40 lead, 70/40 opp), not just "returns
 *    something".
 * 2. The tone classes must be CSS-variable token pairs. Raw Tailwind palette
 *    classes (bg-emerald-100, text-red-800, dark:…) do not follow the
 *    data-theme switch, which is exactly the bug this module replaced — the
 *    guard test fails if anyone reintroduces a raw palette class.
 */

import { describe, expect, it } from 'vitest';

import {
  SCORE_TONE_CLASSES,
  leadScoreTone,
  oppWinProbabilityTone,
  type ScoreTone,
} from './scoreTone';

describe('leadScoreTone — Hot/Warm/Cold boundaries', () => {
  it('maps ≥60 to healthy (the "Hot" band)', () => {
    expect(leadScoreTone(60)).toBe('healthy');
    expect(leadScoreTone(100)).toBe('healthy');
  });

  it('maps 40–59 to watch (the "Warm" band) — 59 must NOT read as Hot', () => {
    expect(leadScoreTone(59)).toBe('watch');
    expect(leadScoreTone(40)).toBe('watch');
  });

  it('maps <40 to risk (the "Cold" band) — 39 must NOT read as Warm', () => {
    expect(leadScoreTone(39)).toBe('risk');
    expect(leadScoreTone(0)).toBe('risk');
  });
});

describe('oppWinProbabilityTone — Likely/Possible/At-risk boundaries', () => {
  it('maps ≥70 to healthy (the "Likely" band) — stricter than the lead band', () => {
    expect(oppWinProbabilityTone(70)).toBe('healthy');
    // 60 is Hot for a lead but only Possible for a win probability.
    expect(oppWinProbabilityTone(69)).toBe('watch');
  });

  it('maps 40–69 to watch and <40 to risk', () => {
    expect(oppWinProbabilityTone(40)).toBe('watch');
    expect(oppWinProbabilityTone(39)).toBe('risk');
  });
});

describe('SCORE_TONE_CLASSES — theme-token discipline', () => {
  const tones = Object.keys(SCORE_TONE_CLASSES) as ScoreTone[];

  it.each(tones)('"%s" uses CSS-variable tokens for both bg and text', (tone) => {
    const classes = SCORE_TONE_CLASSES[tone];
    expect(classes).toMatch(/bg-\[var\(--[a-z-]+\)\]/);
    expect(classes).toMatch(/text-\[var\(--[a-z-]+\)\]/);
  });

  it.each(tones)('"%s" contains no raw Tailwind palette class (breaks dark mode)', (tone) => {
    // e.g. bg-emerald-100, text-red-800, dark:bg-amber-900/30 — none of these
    // track data-theme, so they render light-mode pastels on the dark surface.
    expect(SCORE_TONE_CLASSES[tone]).not.toMatch(
      /(?:bg|text|border)-(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone)-\d/,
    );
  });
});
