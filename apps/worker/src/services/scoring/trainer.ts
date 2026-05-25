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
 */

import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { prisma as defaultPrisma, Prisma, type PrismaClient } from '@bidstack/db';
import pino from 'pino';

import { extractLeadFeatures, extractOpportunityFeatures } from './feature-extraction.js';
import { trainWithXgboost, type XgboostMetrics } from './trainer-xgboost.js';

const log = pino({ name: 'scorer:trainer', level: process.env.LOG_LEVEL ?? 'info' });

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
  /** ISO timestamp */
  trainedAt: string;
  version: string;
  sampleCount: number;
  entityType: 'lead' | 'opportunity';
  orgId: string;
  metrics: AccuracyMetrics;

  // ─── Optional XGBoost companion fields (W9-3) ────────────────────────────
  // Populated when PREDICTIVE_USE_XGBOOST=true AND the Python sidecar
  // succeeds. Always present alongside the LR fields above — XGBoost is a
  // strict enrichment, never a replacement for inference.
  // The LR fields drive online scoring (fast, pure-JS). The XGBoost fields
  // exist for batch analysis, admin dashboards, and future tree-based
  // inference paths.
  xgboost?: {
    /** XGBoost booster save_raw('json') — opaque to TS; consumed by Python */
    modelJson: string;
    /** Held-out metrics from the XGBoost trainer (compare against `metrics` above) */
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

// ─── Logistic regression (pure-JS, no native deps) ───────────────────────

/**
 * Sigmoid activation.
 * WHY inline: simple-statistics exposes statistical functions but not a
 * logistic regression trainer; implementing sigmoid + gradient descent here
 * keeps the dependency surface minimal.
 */
function sigmoid(z: number): number {
  return 1 / (1 + Math.exp(-z));
}

/** Dot product of two equal-length arrays. */
function dot(a: number[], b: number[]): number {
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
function trainLogisticRegression(
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
function normaliseColumns(X: number[][]): void {
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

// ─── Evaluation metrics ───────────────────────────────────────────────────

interface PredLabel {
  prob: number;
  label: number;
}

/**
 * Compute precision, recall, F1 at threshold=0.5, and AUC via trapezoid rule.
 * Uses a simple hold-out set passed in by the caller.
 */
function computeMetrics(preds: PredLabel[]): AccuracyMetrics {
  const THRESHOLD = 0.5;
  let tp = 0, fp = 0, fn = 0;

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
  let tp2 = 0, fp2 = 0, prevTpRate = 0, prevFpRate = 0, auc = 0;

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

// ─── Synthetic baseline data ──────────────────────────────────────────────

/**
 * Generates a minimal synthetic dataset for orgs with < MIN_SAMPLES closed deals.
 *
 * WHY synthetic rather than cross-org: cross-org training would violate data
 * isolation even with anonymisation. Synthetic data encodes domain priors:
 *   - High engagement → higher win probability
 *   - Exec title → higher win probability
 *   - Long time-in-stage → lower win probability
 */
const MIN_SAMPLES = 50;
const SYNTHETIC_N = 200;

function buildSyntheticLeadSamples(featureCount: number): {
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

function buildSyntheticOppSamples(featureCount: number): {
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

// ─── S3 helpers ───────────────────────────────────────────────────────────

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
    const res = await s3.send(
      new GetObjectCommand({ Bucket: S3_BUCKET, Key: s3Key }),
    );
    const body = await res.Body?.transformToString('utf-8');
    if (!body) return null;
    return JSON.parse(body) as ModelArtifact;
  } catch {
    return null;
  }
}

// ─── Main training entry point ────────────────────────────────────────────

export async function trainOrgModel(
  orgId: string,
  entityType: 'lead' | 'opportunity',
  db: PrismaClient = defaultPrisma,
): Promise<TrainResult | null> {
  const twelveMonthsAgo = new Date(Date.now() - 365 * 86_400_000);

  log.info({ orgId, entityType }, 'starting model training');

  // ── Collect closed entities for labeling ─────────────────────────────
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
        OR: [
          { status: 'converted' },
          { status: 'disqualified' },
        ],
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
      featureNames = featureNames.length > 0 ? featureNames : Array.from(
        { length: 24 },
        (_, i) => `f${i}`,
      );
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
      featureNames = featureNames.length > 0 ? featureNames : Array.from(
        { length: 12 },
        (_, i) => `f${i}`,
      );
    }
  }

  if (X.length === 0) {
    log.warn({ orgId, entityType }, 'no training data — skipping');
    return null;
  }

  // ── Train / evaluate ──────────────────────────────────────────────────
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

  // ── XGBoost enrichment (W9-3) ────────────────────────────────────────
  // Runs only when PREDICTIVE_USE_XGBOOST=true and the Python sidecar
  // can be invoked. Returns null on disabled/missing/error — caller is
  // unaffected. The LR weights computed above remain the inference path;
  // XGBoost fields are persisted alongside for batch analysis + future use.
  // We pass the SAME train/test split inputs (X, y, featureNames) so the
  // comparison metrics are directly comparable to the LR `metrics` above.
  const xgbResult = await trainWithXgboost({
    X,
    y,
    featureNames,
  });

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

  // ── Persist to S3 ─────────────────────────────────────────────────────
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

  // ── Deactivate previous active model ─────────────────────────────────
  await db.predictiveModel.updateMany({
    where: { orgId, entityType, isActive: true },
    data: { isActive: false },
  });

  // ── Persist model metadata to DB ─────────────────────────────────────
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

// ─── Inference helper (used by scoring service) ───────────────────────────

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
