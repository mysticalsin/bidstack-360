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
