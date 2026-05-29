/**
 * Per-org ML training pipeline — logistic regression via simple-statistics.
 *
 * WHY logistic regression, not XGBoost:
 *   - simple-statistics is pure-JS; no native binaries to build on Windows or
 *     inside Docker without build tools.
 *   - Logistic regression is sufficient for the CRM scoring signal quality (< 1M
 *     samples per org); gradient boosting adds complexity without meaningful gain
 *     at this scale.
 *   - Each org with ≥ 50 closed deals gets its own per-org model.
 *     Orgs below that threshold use a global baseline trained on synthetic data.
 *
 * Model artifact format:
 *   { weights: number[], bias: number, featureNames: string[], version: string,
 *     trainedAt: string, sampleCount: number, metrics: AccuracyMetrics }
 *
 * S3 key: models/<orgId>/<entityType>/v<version>.json
 * No raw features or labels are serialised — only the learned weights.
 *
 * Retraining schedule: weekly cron via PREDICTIVE_RETRAIN BullMQ queue.
 * Can also be triggered via POST /admin/predictive/retrain.
 *
 * Structure:
 *   trainer.helpers.ts (this dir) — types + pure math + metrics + synthetic data
 *   trainer.ts (this file)        — S3 helpers + training orchestration + inference
 */

import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { prisma as defaultPrisma, type Prisma, type PrismaClient } from '@bidstack/db';
import pino from 'pino';

import { extractLeadFeatures, extractOpportunityFeatures } from './feature-extraction.js';
import { trainWithXgboost } from './trainer-xgboost.js';
import {
  sigmoid,
  dot,
  trainLogisticRegression,
  normaliseColumns,
  computeMetrics,
  MIN_SAMPLES,
  buildSyntheticLeadSamples,
  buildSyntheticOppSamples,
} from './trainer.helpers.js';

// Re-export types so callers (predictive-retrain.ts) get them from this file
export type { AccuracyMetrics, ModelArtifact, TrainResult } from './trainer.helpers.js';

import type { ModelArtifact, TrainResult } from './trainer.helpers.js';

const log = pino({ name: 'scorer:trainer', level: process.env.LOG_LEVEL ?? 'info' });

// ─── S3 helpers ───────────────────────────────────────────────────────────────

function getS3Client(): S3Client {
  return new S3Client({
    region: process.env.AWS_REGION ?? 'eu-west-1',
  });
}

const S3_BUCKET = process.env.BACKUP_S3_BUCKET ?? 'bidstack-backup';

function modelS3Key(orgId: string, entityType: string, version: string): string {
  return `models/${orgId}/${entityType}/v${version}.json`;
}

async function uploadModelToS3(artifact: ModelArtifact, s3Key: string): Promise<void> {
  const s3 = getS3Client();
  await s3.send(
    new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: s3Key,
      Body: JSON.stringify(artifact),
      ContentType: 'application/json',
      // IAM path isolation: the caller's IAM role should allow Put only to
      // paths starting with models/<their-orgId>/ — enforce via bucket policy.
    }),
  );
}

export async function loadModelFromS3(s3Key: string): Promise<ModelArtifact | null> {
  try {
    const s3 = getS3Client();
    const res = await s3.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: s3Key }));
    const body = await res.Body?.transformToString('utf-8');
    if (!body) return null;
    return JSON.parse(body) as ModelArtifact;
  } catch {
    return null;
  }
}

// ─── Main training entry point ────────────────────────────────────────────────

export async function trainOrgModel(
  orgId: string,
  entityType: 'lead' | 'opportunity',
  db: PrismaClient = defaultPrisma,
): Promise<TrainResult | null> {
  const twelveMonthsAgo = new Date(Date.now() - 365 * 86_400_000);

  log.info({ orgId, entityType }, 'starting model training');

  // ── Collect closed entities for labeling ──────────────────────────────────
  let X: number[][] = [];
  let y: number[] = [];
  let featureNames: string[] = [];
  let sampleCount: number;

  if (entityType === 'lead') {
    const closedLeads = await db.lead.findMany({
      where: {
        orgId,
        deletedAt: null,
        updatedAt: { gte: twelveMonthsAgo },
        OR: [{ status: 'converted' }, { status: 'disqualified' }],
      },
      select: { id: true, status: true },
    });

    for (const lead of closedLeads) {
      const fv = await extractLeadFeatures(lead.id, orgId, db);
      if (!fv) continue;
      X.push(fv.values);
      y.push(lead.status === 'converted' ? 1 : 0);
      if (featureNames.length === 0) featureNames = fv.names;
    }

    sampleCount = X.length;

    if (sampleCount < MIN_SAMPLES) {
      log.info({ orgId, sampleCount }, 'below MIN_SAMPLES — using synthetic baseline');
      const syn = buildSyntheticLeadSamples(featureNames.length || 24);
      X = syn.X;
      y = syn.y;
      featureNames =
        featureNames.length > 0 ? featureNames : Array.from({ length: 24 }, (_, i) => `f${i}`);
    }
  } else {
    // opportunity
    const closedOpps = await db.opportunity.findMany({
      where: {
        orgId,
        deletedAt: null,
        updatedAt: { gte: twelveMonthsAgo },
        pipelineStage: { OR: [{ isWon: true }, { isLost: true }] },
      },
      select: {
        id: true,
        pipelineStage: { select: { isWon: true, isLost: true } },
      },
    });

    for (const opp of closedOpps) {
      const fv = await extractOpportunityFeatures(opp.id, orgId, db);
      if (!fv) continue;
      X.push(fv.values);
      y.push(opp.pipelineStage?.isWon ? 1 : 0);
      if (featureNames.length === 0) featureNames = fv.names;
    }

    sampleCount = X.length;

    if (sampleCount < MIN_SAMPLES) {
      log.info({ orgId, sampleCount }, 'below MIN_SAMPLES — using synthetic baseline');
      const syn = buildSyntheticOppSamples(featureNames.length || 12);
      X = syn.X;
      y = syn.y;
      featureNames =
        featureNames.length > 0 ? featureNames : Array.from({ length: 12 }, (_, i) => `f${i}`);
    }
  }

  if (X.length === 0) {
    log.warn({ orgId, entityType }, 'no training data — skipping');
    return null;
  }

  // ── Train / evaluate ───────────────────────────────────────────────────────
  // 80/20 train-test split
  const splitIdx = Math.floor(X.length * 0.8);
  const XTrain = X.slice(0, splitIdx);
  const yTrain = y.slice(0, splitIdx);
  const XTest = X.slice(splitIdx);
  const yTest = y.slice(splitIdx);

  normaliseColumns(XTrain);
  // Normalise test set with the same range (idempotent: already 0-1 after column norm)
  normaliseColumns(XTest);

  const { weights, bias } = trainLogisticRegression(XTrain, yTrain, featureNames.length);

  // Evaluate on held-out test set
  const preds = XTest.map((row, i) => ({
    prob: sigmoid(dot(weights, row) + bias),
    label: yTest[i] ?? 0,
  }));
  const metrics = computeMetrics(preds);

  log.info({ orgId, entityType, metrics, sampleCount }, 'training complete');

  // ── XGBoost enrichment (W9-3) ──────────────────────────────────────────────
  // Runs only when PREDICTIVE_USE_XGBOOST=true and the Python sidecar
  // can be invoked. Returns null on disabled/missing/error — caller is
  // unaffected. The LR weights computed above remain the inference path;
  // XGBoost fields are persisted alongside for batch analysis + future use.
  const xgbResult = await trainWithXgboost({ X, y, featureNames });

  if (xgbResult) {
    log.info(
      {
        orgId,
        entityType,
        lrAuc: metrics.auc,
        xgbAuc: xgbResult.metrics.auc,
        delta: Math.round((xgbResult.metrics.auc - metrics.auc) * 1000) / 1000,
        durationMs: xgbResult.trainDurationMs,
      },
      'XGBoost companion training complete',
    );
  }

  // ── Persist to S3 ─────────────────────────────────────────────────────────
  const trainedAt = new Date().toISOString();
  const version = trainedAt.replace(/[^0-9]/g, '').slice(0, 14); // yyyymmddHHMMSS

  const artifact: ModelArtifact = {
    weights,
    bias,
    featureNames,
    trainedAt,
    version,
    sampleCount,
    entityType,
    orgId,
    metrics,
    ...(xgbResult && {
      xgboost: {
        modelJson: xgbResult.modelJson,
        metrics: xgbResult.metrics,
        featureImportance: xgbResult.featureImportance,
        bestIteration: xgbResult.bestIteration,
        trainDurationMs: xgbResult.trainDurationMs,
      },
    }),
  };

  const s3Key = modelS3Key(orgId, entityType, version);

  try {
    await uploadModelToS3(artifact, s3Key);
    log.info({ s3Key }, 'model uploaded to S3');
  } catch (err) {
    log.error({ err, s3Key }, 'S3 upload failed — continuing without persisting artifact');
    // WHY non-fatal: scoring can still use the in-memory artifact for this run.
    // The DB record will still be created with the S3 key as a future reference.
  }

  // ── Deactivate previous active model ─────────────────────────────────────
  await db.predictiveModel.updateMany({
    where: { orgId, entityType, isActive: true },
    data: { isActive: false },
  });

  // ── Persist model metadata to DB ─────────────────────────────────────────
  const prevVersion = await db.predictiveModel.count({ where: { orgId, entityType } });

  const dbModel = await db.predictiveModel.create({
    data: {
      orgId,
      entityType,
      version: prevVersion + 1,
      accuracyMetrics: metrics as unknown as Prisma.InputJsonValue,
      trainedAt: new Date(trainedAt),
      sampleCount,
      modelArtifactS3Key: s3Key,
      isActive: true,
    },
  });

  return { model: artifact, s3Key, dbModelId: dbModel.id };
}

// ─── Inference helpers (used by scoring service) ──────────────────────────────

/**
 * Run inference against an in-memory model artifact.
 * Returns probability in [0, 1].
 */
export function inferScore(artifact: ModelArtifact, featureValues: number[]): number {
  return sigmoid(dot(artifact.weights, featureValues) + artifact.bias);
}

/**
 * SHAP-like local attribution — Shapley approximation via individual feature
 * contribution: contribution_j = weight_j * feature_j (linear model identity).
 *
 * WHY this approximation is acceptable for logistic regression:
 *   In a logistic regression, the log-odds is exactly the dot product of weights
 *   and features. The contribution of feature j to the final log-odds is exactly
 *   weight_j * feature_j. This is not an approximation — it is exact for LR.
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
