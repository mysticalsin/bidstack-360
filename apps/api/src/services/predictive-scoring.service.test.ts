/**
 * Unit tests pinning the canonical PredictiveScore scale + degradation math.
 *
 * WHY these tests matter:
 *   The persisted PredictiveScore.score column is shared by BOTH the ML path
 *   (predictive-scoring.service.ts) and the heuristic path (routes/predictive.ts),
 *   and is validated by the shared schema as an integer in [0, 10000] (basis
 *   points). A regression to a 0–100 scale here re-opens the dual-scale bug:
 *   heuristic rows (e.g. 8500) and ML rows would be silently incomparable, and
 *   the 7-day degradation guard would never fire. These tests fail the moment
 *   the canonical scale or the degradation formula drifts.
 */

import { describe, expect, it } from 'vitest';

import {
  basisPointsToPercent,
  degradationPercentPoints,
  isRealTrainingSampleCount,
  probabilityToBasisPoints,
  unscoredLeadScore,
  unscoredOpportunityScore,
} from './predictive-scoring.service.js';

describe('isRealTrainingSampleCount', () => {
  it('rejects a stored model whose sample count is below the real-history floor', () => {
    // Why: older runs saved synthetic fits with the real closed-record count, under 50.
    expect(isRealTrainingSampleCount(0)).toBe(false);
    expect(isRealTrainingSampleCount(49)).toBe(false);
    expect(isRealTrainingSampleCount(50)).toBe(true);
  });
});

describe('unscored model fallback', () => {
  it('does not invent a 50% win probability when no model is trained', () => {
    const score = unscoredOpportunityScore('2026-06-01T00:00:00.000Z');
    expect(score.winProbability).toBeNull();
    expect(score.predictedCloseDate).toBeNull();
    expect(score.modelVersion).toBe('fallback-v0');
    expect(score.recommendation).toMatch(/not a win forecast/i);
  });

  it('does not invent a 50 lead score when no model is trained', () => {
    expect(unscoredLeadScore('2026-06-01T00:00:00.000Z').score).toBeNull();
  });
});

describe('probabilityToBasisPoints — canonical persisted scale', () => {
  it('maps probability [0,1] onto integer basis points [0,10000]', () => {
    expect(probabilityToBasisPoints(0)).toBe(0);
    expect(probabilityToBasisPoints(0.5)).toBe(5000);
    expect(probabilityToBasisPoints(0.85)).toBe(8500);
    expect(probabilityToBasisPoints(1)).toBe(10000);
  });

  it('always returns an integer (the DB column + shared schema require int)', () => {
    for (const p of [0.0001, 0.12345, 0.6789, 0.99999]) {
      expect(Number.isInteger(probabilityToBasisPoints(p))).toBe(true);
    }
  });

  it('clamps out-of-range probabilities into [0,10000]', () => {
    expect(probabilityToBasisPoints(-0.5)).toBe(0);
    expect(probabilityToBasisPoints(1.5)).toBe(10000);
  });

  it('maps 0.85 onto 8500 basis points, the same scale stored scores use', () => {
    // The PredictiveScore column is basis points. A model probability of 0.85
    // must land on 8500 so it stays comparable with any older stored row.
    expect(probabilityToBasisPoints(0.85)).toBe(8500);
  });
});

describe('basisPointsToPercent — public API edge', () => {
  it('derives the 0–100 contract value from canonical basis points', () => {
    expect(basisPointsToPercent(0)).toBe(0);
    expect(basisPointsToPercent(5000)).toBe(50);
    expect(basisPointsToPercent(8500)).toBe(85);
    expect(basisPointsToPercent(10000)).toBe(100);
  });

  it('round-trips probability → bp → percent for the response schema bounds', () => {
    // The response schema (OppScoreResponse / LeadScoreResponse) caps at 100.
    const percent = basisPointsToPercent(probabilityToBasisPoints(0.999));
    expect(percent).toBeGreaterThanOrEqual(0);
    expect(percent).toBeLessThanOrEqual(100);
  });
});

describe('degradationPercentPoints — 7-day drop formula', () => {
  it('returns percentage-point drop from two basis-point scores', () => {
    // 8500 bp (85%) → 6500 bp (65%) is a 20-point drop.
    expect(degradationPercentPoints(8500, 6500)).toBe(20);
  });

  it('is zero when the score is unchanged', () => {
    expect(degradationPercentPoints(7000, 7000)).toBe(0);
  });

  it('is negative when the score improved (no false degradation alert)', () => {
    expect(degradationPercentPoints(5000, 8000)).toBe(-30);
  });

  it('fires the >=20pt guard for a real 7-day drop (regression: guard was dead)', () => {
    // Previously the math mixed 0–1 with 0–100 and this guard never fired.
    const drop = degradationPercentPoints(9000, 6900); // 90% → 69% = 21pt
    expect(drop).toBeGreaterThanOrEqual(20);
  });
});
