/**
 * Inference-only subset of the trainer — used by the API scoring service.
 *
 * WHY a separate file from apps/worker/src/services/scoring/trainer.ts:
 *   The API needs sigmoid, inferScore, shapAttributions, and loadModelFromS3
 *   but NOT the full training pipeline (BullMQ, Prisma write paths, synthetic
 *   data generation). This file re-exports only the inference primitives to
 *   keep the API bundle minimal.
 *
 *   The training pipeline lives in apps/worker — the API triggers it via
 *   BullMQ (enqueue to PREDICTIVE_RETRAIN queue) rather than calling it directly.
 */

import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';

// ─── Types ────────────────────────────────────────────────────────────────

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
  trainedAt: string;
  version: string;
  sampleCount: number;
  entityType: 'lead' | 'opportunity';
  orgId: string;
  metrics: AccuracyMetrics;

  // ─── Optional XGBoost companion (W9-3, populated by the worker trainer) ──
  // When present, inferXgboostScore() below uses this instead of LR weights.
  // Falls back to LR when the XGBoost sidecar has not yet run for this org.
  xgboost?: {
    modelJson: string;
    metrics: AccuracyMetrics;
    featureImportance: Record<string, number>;
    bestIteration: number;
    trainDurationMs: number;
  };
}

// ─── Math primitives ─────────────────────────────────────────────────────

function sigmoid(z: number): number {
  return 1 / (1 + Math.exp(-z));
}

function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] ?? 0) * (b[i] ?? 0);
  return s;
}

// ─── Inference ────────────────────────────────────────────────────────────

/** Run logistic regression inference. Returns probability in [0, 1]. */
export function inferScore(artifact: ModelArtifact, featureValues: number[]): number {
  return sigmoid(dot(artifact.weights, featureValues) + artifact.bias);
}

/**
 * Exact SHAP attributions for logistic regression.
 * For LR, contribution_j = weight_j × feature_j is exact (not an approximation).
 */
export function shapAttributions(
  artifact: ModelArtifact,
  featureValues: number[],
): Array<{ feature: string; contribution: number }> {
  return artifact.featureNames
    .map((name, i) => ({
      feature: name,
      contribution: (artifact.weights[i] ?? 0) * (featureValues[i] ?? 0),
    }))
    .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));
}

// ─── XGBoost tree inference ────────────────────────────────────────────────

interface XgbTree {
  left_children: number[];
  right_children: number[];
  split_indices: number[];
  split_conditions: number[];
  default_left: number[];
}

interface XgbModelJson {
  learner: {
    learner_model_param: { base_score: string };
    gradient_booster: { model: { trees: XgbTree[] } };
    objective: { name: string };
  };
}

/**
 * Run XGBoost inference from the raw model JSON produced by
 * `booster.save_raw("json")`. Returns probability in [0,1], or null
 * when the JSON is unparseable or has an unexpected shape.
 *
 * WHY TypeScript instead of spawning Python:
 *   A Python sidecar adds 200–400ms of cold-start per inference.
 *   Walking XGBoost's array-indexed tree format is O(depth × n_trees)
 *   in JS — typically < 1ms for a 100-tree, depth-6 forest.
 */
export function inferXgboostScore(modelJson: string, featureValues: number[]): number | null {
  let parsed: XgbModelJson;
  try {
    parsed = JSON.parse(modelJson) as XgbModelJson;
  } catch {
    return null;
  }
  const trees = parsed.learner?.gradient_booster?.model?.trees;
  if (!Array.isArray(trees) || trees.length === 0) return null;

  // base_score is stored in probability space for binary:logistic — convert to log-odds
  // so it can be summed with raw tree margins before the final sigmoid.
  const baseScoreRaw = parsed.learner.learner_model_param?.base_score ?? '0.5';
  const baseScoreP = parseFloat(baseScoreRaw);
  const baseScore =
    !isNaN(baseScoreP) && baseScoreP > 0 && baseScoreP < 1
      ? Math.log(baseScoreP / (1 - baseScoreP))
      : 0;

  let margin = baseScore;
  for (const tree of trees) {
    margin += walkXgbTree(tree, featureValues);
  }
  return sigmoid(margin);
}

function walkXgbTree(tree: XgbTree, features: number[]): number {
  let node = 0;
  // left_children[node] === -1 means this is a leaf node
  while ((tree.left_children[node] ?? -1) !== -1) {
    const featureIdx = tree.split_indices[node] ?? 0;
    const threshold = tree.split_conditions[node] ?? 0;
    const value = features[featureIdx];
    if (value === undefined || Number.isNaN(value)) {
      // Missing value: follow the default_left direction configured at training time
      node =
        (tree.default_left[node] ?? 0)
          ? (tree.left_children[node] ?? 0)
          : (tree.right_children[node] ?? 0);
    } else if (value < threshold) {
      node = tree.left_children[node] ?? 0;
    } else {
      node = tree.right_children[node] ?? 0;
    }
  }
  return tree.split_conditions[node] ?? 0; // leaf value at this terminal node
}

/**
 * Proxy attributions for XGBoost using gain-based importance × feature value.
 *
 * WHY a proxy and not exact TreeSHAP:
 *   Exact TreeSHAP is O(T × L × D) per prediction — expensive in JS for
 *   100-tree forests. The gain-based proxy is O(n_features) and sufficient
 *   for "which features matter" UI cards. Exact SHAP remains available via
 *   the Python training sidecar for offline analysis.
 */
export function xgboostShapProxy(
  artifact: ModelArtifact,
  featureValues: number[],
): Array<{ feature: string; contribution: number }> {
  const imp = artifact.xgboost?.featureImportance ?? {};
  return artifact.featureNames
    .map((name, i) => ({
      feature: name,
      contribution: (imp[name] ?? 0) * (featureValues[i] ?? 0),
    }))
    .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));
}

// ─── S3 loader ────────────────────────────────────────────────────────────

const S3_BUCKET = process.env.BACKUP_S3_BUCKET ?? 'bidstack-backup';

/** Load a model artifact from S3 by key. Returns null on any failure. */
export async function loadModelFromS3(s3Key: string): Promise<ModelArtifact | null> {
  try {
    const s3 = new S3Client({ region: process.env.AWS_REGION ?? 'eu-west-1' });
    const res = await s3.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: s3Key }));
    const body = await res.Body?.transformToString('utf-8');
    if (!body) return null;
    return JSON.parse(body) as ModelArtifact;
  } catch {
    return null;
  }
}
