/**
 * Trainer helpers — private math, metrics, and synthetic-data utilities.
 *
 * Imported only by trainer.ts. Not part of the public scoring API.
 *
 * Contents:
 *   Types               — AccuracyMetrics, ModelArtifact, TrainResult
 *   Pure math           — sigmoid, dot, trainLogisticRegression, normaliseColumns
 *   Evaluation metrics  — computeMetrics
 *   Synthetic data      — buildSyntheticLeadSamples, buildSyntheticOppSamples
 */

import type { XgboostMetrics } from './trainer-xgboost.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AccuracyMetrics {
  precision: number;
  recall: number;
  auc: number;
  f1: number;
}

export interface ModelArtifact {
  weights: number[];
  bias: number;
  featureNames: string[];
  /** ISO timestamp */
  trainedAt: string;
  version: string;
  sampleCount: number;
  entityType: 'lead' | 'opportunity';
  orgId: string;
  metrics: AccuracyMetrics;

  // ─── Optional XGBoost companion fields (W9-3) ──────────────────────────────
  // Populated when PREDICTIVE_USE_XGBOOST=true AND the Python sidecar
  // succeeds. Always present alongside the LR fields above — XGBoost is a
  // strict enrichment, never a replacement for inference.
  xgboost?: {
    /** XGBoost booster save_raw('json') — opaque to TS; consumed by Python */
    modelJson: string;
    /** Held-out metrics from the XGBoost trainer */
    metrics: XgboostMetrics;
    /** Gain-based feature importance, normalized to sum=1.0 */
    featureImportance: Record<string, number>;
    /** Best boosting round (≤ n_estimators, may be less if early-stopped) */
    bestIteration: number;
    /** Milliseconds spent in the Python sidecar */
    trainDurationMs: number;
  };
}

export interface TrainResult {
  model: ModelArtifact;
  s3Key: string;
  dbModelId: string;
}

// ─── Pure math ────────────────────────────────────────────────────────────────

/**
 * Sigmoid activation.
 * WHY inline: simple-statistics exposes statistical functions but not a
 * logistic regression trainer; implementing sigmoid + gradient descent here
 * keeps the dependency surface minimal.
 */
export function sigmoid(z: number): number {
  return 1 / (1 + Math.exp(-z));
}

/** Dot product of two equal-length arrays. */
export function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] ?? 0) * (b[i] ?? 0);
  return s;
}

/**
 * Mini-batch gradient descent logistic regression.
 *
 * Hyperparameters are intentionally conservative: 200 epochs, lr=0.01,
 * L2 λ=0.001. These are good defaults for CRM signal quality without
 * overfitting on small org datasets (50-500 samples).
 */
export function trainLogisticRegression(
  X: number[][],
  y: number[],
  featureCount: number,
): { weights: number[]; bias: number } {
  const epochs = 200;
  const lr = 0.01;
  const lambda = 0.001; // L2 regularisation

  const weights = new Array<number>(featureCount).fill(0);
  let bias = 0;
  const n = X.length;

  for (let epoch = 0; epoch < epochs; epoch++) {
    const gradW = new Array<number>(featureCount).fill(0);
    let gradB = 0;

    for (let i = 0; i < n; i++) {
      const xRow = X[i] ?? [];
      const yHat = sigmoid(dot(weights, xRow) + bias);
      const err = yHat - (y[i] ?? 0);
      for (let j = 0; j < featureCount; j++) {
        gradW[j] = (gradW[j] ?? 0) + (err * (xRow[j] ?? 0)) / n;
      }
      gradB += err / n;
    }

    for (let j = 0; j < featureCount; j++) {
      weights[j] = (weights[j] ?? 0) - lr * ((gradW[j] ?? 0) + lambda * (weights[j] ?? 0));
    }
    bias -= lr * gradB;
  }

  return { weights, bias };
}

/** Min-max normalise each column of the feature matrix in-place. */
export function normaliseColumns(X: number[][]): void {
  if (X.length === 0) return;
  const cols = X[0]?.length ?? 0;
  for (let j = 0; j < cols; j++) {
    const col = X.map((row) => row[j] ?? 0);
    const min = Math.min(...col);
    const max = Math.max(...col);
    const range = max - min === 0 ? 1 : max - min;
    for (const row of X) {
      row[j] = ((row[j] ?? 0) - min) / range;
    }
  }
}

// ─── Evaluation metrics ───────────────────────────────────────────────────────

interface PredLabel {
  prob: number;
  label: number;
}

/**
 * Compute precision, recall, F1 at threshold=0.5, and AUC via trapezoid rule.
 * Uses a simple hold-out set passed in by the caller.
 */
export function computeMetrics(preds: PredLabel[]): AccuracyMetrics {
  const THRESHOLD = 0.5;
  let tp = 0,
    fp = 0,
    fn = 0;

  for (const { prob, label } of preds) {
    const pred = prob >= THRESHOLD ? 1 : 0;
    if (pred === 1 && label === 1) tp++;
    else if (pred === 1 && label === 0) fp++;
    else if (pred === 0 && label === 1) fn++;
  }

  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

  // AUC: sort by descending probability, walk ROC curve
  const sorted = [...preds].sort((a, b) => b.prob - a.prob);
  const totalPos = preds.filter((p) => p.label === 1).length;
  const totalNeg = preds.length - totalPos;
  let tp2 = 0,
    fp2 = 0,
    prevTpRate = 0,
    prevFpRate = 0,
    auc = 0;

  for (const { label } of sorted) {
    if (label === 1) tp2++;
    else fp2++;
    const tpRate = totalPos > 0 ? tp2 / totalPos : 0;
    const fpRate = totalNeg > 0 ? fp2 / totalNeg : 0;
    auc += (fpRate - prevFpRate) * ((tpRate + prevTpRate) / 2);
    prevTpRate = tpRate;
    prevFpRate = fpRate;
  }

  return {
    precision: Math.round(precision * 1000) / 1000,
    recall: Math.round(recall * 1000) / 1000,
    f1: Math.round(f1 * 1000) / 1000,
    auc: Math.round(auc * 1000) / 1000,
  };
}

// ─── Synthetic baseline data ──────────────────────────────────────────────────

/**
 * Generates a minimal synthetic dataset for orgs with < MIN_SAMPLES closed deals.
 *
 * WHY synthetic rather than cross-org: cross-org training would violate data
 * isolation even with anonymisation. Synthetic data encodes domain priors:
 *   - High engagement → higher win probability
 *   - Exec title → higher win probability
 *   - Long time-in-stage → lower win probability
 */
export const MIN_SAMPLES = 50;
export const SYNTHETIC_N = 200;

export function buildSyntheticLeadSamples(featureCount: number): {
  X: number[][];
  y: number[];
} {
  const X: number[][] = [];
  const y: number[] = [];
  const rng = (min = 0, max = 1) => min + Math.random() * (max - min);

  for (let i = 0; i < SYNTHETIC_N; i++) {
    // engagement_count_30d (index 16) and title_seniority (index 15) drive the label
    const row = new Array<number>(featureCount).fill(0);
    const seniority = Math.floor(rng(0, 4));
    const engagement = Math.floor(rng(0, 20));
    const bantScore = rng(0, 1);
    // indices 14=seniority, 16=engagement_count, 20-23=bant
    row[14] = seniority;
    row[16] = engagement;
    row[20] = bantScore;
    const logit = -1 + 0.4 * seniority + 0.1 * engagement + bantScore;
    const prob = sigmoid(logit);
    X.push(row);
    y.push(Math.random() < prob ? 1 : 0);
  }
  return { X, y };
}

export function buildSyntheticOppSamples(featureCount: number): {
  X: number[][];
  y: number[];
} {
  const X: number[][] = [];
  const y: number[] = [];
  const rng = (min = 0, max = 1) => min + Math.random() * (max - min);

  for (let i = 0; i < SYNTHETIC_N; i++) {
    const row = new Array<number>(featureCount).fill(0);
    const stageProbability = rng(0.1, 0.9);
    const meetings = Math.floor(rng(0, 15));
    const ownerRate = rng(0.2, 0.8);
    const qualScore = rng(0, 1);
    row[1] = stageProbability;
    row[6] = meetings;
    row[8] = ownerRate;
    row[9] = qualScore;
    const logit = -1.5 + 2 * stageProbability + 0.08 * meetings + ownerRate + qualScore;
    const prob = sigmoid(logit);
    X.push(row);
    y.push(Math.random() < prob ? 1 : 0);
  }
  return { X, y };
}
