/**
 * Unit tests for XGBoost inference helpers in trainer.ts.
 *
 * WHY these tests matter:
 *   The tree-walker is pure math — no DB, no network, no Python.
 *   If it mis-routes a node or misreads the base_score, every live inference
 *   will be silently wrong. These tests lock in correctness with a hand-
 *   computed reference model.
 */

import { describe, expect, it } from 'vitest';

import { inferXgboostScore, xgboostShapProxy, type ModelArtifact } from './trainer.js';

// ─── Reference model ──────────────────────────────────────────────────────
//
// Single tree:
//   node 0 (root): feature[0] < 0.5  → left (node 1) / right (node 2)
//   node 1 (leaf): value = -0.4
//   node 2 (leaf): value = +0.4
//
// base_score = 0.5 (prob space) → 0.0 log-odds
//
// Expected margins & probabilities (hand-computed):
//   feature[0] = 0.3  → left leaf -0.4 → sigmoid(-0.4) ≈ 0.4013
//   feature[0] = 0.7  → right leaf +0.4 → sigmoid(+0.4) ≈ 0.5987
//   feature[0] = NaN  → default_left=0 (false=right) → right leaf +0.4 → ≈ 0.5987
//   feature[0] = 0.5  → NOT < 0.5 → right leaf +0.4 → ≈ 0.5987  (boundary)

const ONE_TREE_MODEL_JSON = JSON.stringify({
  learner: {
    learner_model_param: { base_score: '5e-01' },
    gradient_booster: {
      model: {
        trees: [
          {
            left_children: [1, -1, -1],
            right_children: [2, -1, -1],
            split_indices: [0, 0, 0],
            split_conditions: [0.5, -0.4, 0.4],
            default_left: [0, 0, 0], // 0 = default to right on missing
          },
        ],
      },
    },
    objective: { name: 'binary:logistic' },
  },
});

function sigmoid(z: number): number {
  return 1 / (1 + Math.exp(-z));
}

describe('inferXgboostScore', () => {
  it('routes left when feature < threshold', () => {
    const prob = inferXgboostScore(ONE_TREE_MODEL_JSON, [0.3]);
    expect(prob).not.toBeNull();
    expect(prob!).toBeCloseTo(sigmoid(-0.4), 5);
  });

  it('routes right when feature >= threshold (exact boundary)', () => {
    const prob = inferXgboostScore(ONE_TREE_MODEL_JSON, [0.5]);
    expect(prob).not.toBeNull();
    expect(prob!).toBeCloseTo(sigmoid(0.4), 5);
  });

  it('routes right when feature > threshold', () => {
    const prob = inferXgboostScore(ONE_TREE_MODEL_JSON, [0.7]);
    expect(prob).not.toBeNull();
    expect(prob!).toBeCloseTo(sigmoid(0.4), 5);
  });

  it('follows default_left=false (right) on NaN feature', () => {
    const prob = inferXgboostScore(ONE_TREE_MODEL_JSON, [NaN]);
    expect(prob).not.toBeNull();
    expect(prob!).toBeCloseTo(sigmoid(0.4), 5);
  });

  it('follows default_left=false (right) on missing (sparse) feature', () => {
    // featureValues is shorter than split_indices reference → treated as undefined
    const prob = inferXgboostScore(ONE_TREE_MODEL_JSON, []);
    expect(prob).not.toBeNull();
    expect(prob!).toBeCloseTo(sigmoid(0.4), 5);
  });

  it('applies base_score in log-odds space (not probability space)', () => {
    // base_score 0.9 in prob → log(0.9/0.1) = log(9) ≈ 2.197
    const highBaseJson = JSON.stringify({
      learner: {
        learner_model_param: { base_score: '0.9' },
        gradient_booster: {
          model: {
            trees: [
              // single-leaf tree (root is leaf): split_conditions[0] = 0.0
              {
                left_children: [-1],
                right_children: [-1],
                split_indices: [0],
                split_conditions: [0.0],
                default_left: [0],
              },
            ],
          },
        },
        objective: { name: 'binary:logistic' },
      },
    });
    const prob = inferXgboostScore(highBaseJson, [0]);
    expect(prob).not.toBeNull();
    // margin = log(9) + 0 leaf ≈ 2.197 → sigmoid ≈ 0.9
    expect(prob!).toBeCloseTo(0.9, 2);
  });

  it('returns null on malformed JSON', () => {
    expect(inferXgboostScore('{bad json', [1, 2])).toBeNull();
  });

  it('returns null on empty trees array', () => {
    const empty = JSON.stringify({
      learner: {
        learner_model_param: { base_score: '0.5' },
        gradient_booster: { model: { trees: [] } },
        objective: { name: 'binary:logistic' },
      },
    });
    expect(inferXgboostScore(empty, [0.5])).toBeNull();
  });

  it('returns probability in [0, 1]', () => {
    for (const v of [0.0, 0.25, 0.5, 0.75, 1.0]) {
      const p = inferXgboostScore(ONE_TREE_MODEL_JSON, [v]);
      expect(p).not.toBeNull();
      expect(p!).toBeGreaterThanOrEqual(0);
      expect(p!).toBeLessThanOrEqual(1);
    }
  });
});

describe('xgboostShapProxy', () => {
  const artifact: ModelArtifact = {
    weights: [0.1, 0.2, 0.3],
    bias: 0,
    featureNames: ['days_since_contact', 'email_opens', 'call_count'],
    trainedAt: '2025-01-01T00:00:00Z',
    version: 'v1',
    sampleCount: 100,
    entityType: 'lead',
    orgId: 'org-test',
    metrics: { precision: 0.8, recall: 0.8, auc: 0.85, f1: 0.8 },
    xgboost: {
      modelJson: ONE_TREE_MODEL_JSON,
      metrics: { precision: 0.85, recall: 0.85, auc: 0.9, f1: 0.85 },
      featureImportance: {
        days_since_contact: 0.5,
        email_opens: 0.3,
        call_count: 0.2,
      },
      bestIteration: 42,
      trainDurationMs: 1200,
    },
  };

  it('returns one entry per feature', () => {
    const attrs = xgboostShapProxy(artifact, [10, 3, 5]);
    expect(attrs).toHaveLength(3);
  });

  it('computes contribution as importance × feature value', () => {
    const attrs = xgboostShapProxy(artifact, [10, 3, 5]);
    const daysSince = attrs.find((a) => a.feature === 'days_since_contact');
    expect(daysSince?.contribution).toBeCloseTo(0.5 * 10, 5); // 5.0
  });

  it('sorts by absolute contribution descending', () => {
    const attrs = xgboostShapProxy(artifact, [10, 3, 5]);
    // days_since_contact = 5.0 > call_count = 1.0 > email_opens = 0.9
    expect(attrs[0]!.feature).toBe('days_since_contact');
  });

  it('handles missing featureImportance gracefully', () => {
    const noImp: ModelArtifact = { ...artifact, xgboost: undefined };
    const attrs = xgboostShapProxy(noImp, [10, 3, 5]);
    for (const a of attrs) {
      expect(a.contribution).toBe(0);
    }
  });
});
