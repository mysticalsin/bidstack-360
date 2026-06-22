/**
 * Predictive scoring service — inference layer for the API.
 *
 * Architecture:
 *   1. Load the active model artifact from S3 (cached in Redis 1h).
 *   2. Extract features via the shared extraction functions.
 *   3. Run logistic regression inference.
 *   4. Persist/update PredictiveScore in DB.
 *   5. Return score + SHAP attributions to caller.
 *
 * WHY we cache model artifacts in Redis:
 *   Each scoring request would otherwise incur an S3 GET (~100ms).
 *   Model updates are weekly; 1h TTL balances freshness vs. latency.
 *
 * WHY we cache per-entity scores in Redis:
 *   Heavy pages (opportunity list) may render 50+ scores simultaneously.
 *   Redis cache prevents N×DB+S3 round-trips. Score is invalidated on
 *   lead/opp update (see invalidateEntityScore).
 *
 * Multi-tenancy:
 *   Every DB query is scoped by orgId. Redis keys include orgId.
 *   Model artifacts are namespaced by orgId in S3.
 *   No cross-org data ever flows through this service.
 */

import { prisma } from '@bidstack/db';
import pino from 'pino';
import type Redis from 'ioredis';

import {
  loadModelFromS3,
  inferScore,
  inferXgboostScore,
  shapAttributions,
  xgboostShapProxy,
  type ModelArtifact,
} from './scoring/trainer.js';
import { extractLeadFeatures, extractOpportunityFeatures } from './scoring/feature-extraction.js';

const log = pino({ name: 'service:predictive-scoring', level: process.env.LOG_LEVEL ?? 'info' });

// ─── Types ────────────────────────────────────────────────────────────────

export interface ScoreFactor {
  feature: string;
  contribution: number;
}

export interface LeadScoreResult {
  score: number; // 0-100
  factors: ScoreFactor[];
  modelVersion: string;
  scoredAt: string;
}

export interface OppScoreResult {
  winProbability: number; // 0-100
  predictedCloseDate: string | null;
  factors: ScoreFactor[];
  recommendation: string;
  modelVersion: string;
  scoredAt: string;
}

// ─── Canonical score scale ──────────────────────────────────────────────────
//
// WHY basis points: the persisted PredictiveScore.score column is the single
// source of truth shared by BOTH this ML path AND the heuristic path
// (routes/predictive.ts). The heuristic writer and the shared
// PredictiveScore schema (packages/shared) both use integer basis points
// (0–10000). This service used to persist a 0–100 value, so a heuristic row
// (e.g. 8500) and an ML row (e.g. 85) for the same target were silently
// incomparable — the 7-day degradation comparison below mixed the two scales
// and the >= drop guard could never fire reliably. We standardise on basis
// points for everything that touches the DB, and derive the public 0–100
// API value at the edge.
const BASIS_POINTS_SCALE = 10_000;
const PERCENT_SCALE = 100;
const BP_PER_PERCENT = BASIS_POINTS_SCALE / PERCENT_SCALE; // 100

/** A 7-day drop of this many basis points (20 percentage points) is "degraded". */
const DEGRADATION_THRESHOLD_BP = 20 * BP_PER_PERCENT; // 2000

/** Convert a model probability in [0,1] to an integer basis-point score in [0,10000]. */
export function probabilityToBasisPoints(prob: number): number {
  const clamped = Math.min(1, Math.max(0, prob));
  return Math.round(clamped * BASIS_POINTS_SCALE);
}

/** Convert a basis-point score (0–10000) to the public 0–100 percentage scale. */
export function basisPointsToPercent(bp: number): number {
  return Math.round(bp / BP_PER_PERCENT);
}

/**
 * 7-day score degradation in percentage points, given previous and current
 * scores expressed in the SAME basis-point scale. Positive = score fell.
 */
export function degradationPercentPoints(previousBp: number, currentBp: number): number {
  return (previousBp - currentBp) / BP_PER_PERCENT;
}

// ─── Cache key helpers ────────────────────────────────────────────────────

const MODEL_CACHE_TTL_S = 3_600; // 1h
const SCORE_CACHE_TTL_S = 3_600; // 1h

function modelCacheKey(orgId: string, entityType: string): string {
  return `predictive:model:${orgId}:${entityType}`;
}

function scoreCacheKey(orgId: string, entityType: string, entityId: string): string {
  return `predictive:score:${orgId}:${entityType}:${entityId}`;
}

// ─── Model loading ────────────────────────────────────────────────────────

/**
 * Load and cache active model for an org/entity-type pair.
 * Falls back to null if no model exists yet (score will be 50).
 */
async function loadActiveModel(
  orgId: string,
  entityType: 'lead' | 'opportunity',
  redis: Redis,
): Promise<ModelArtifact | null> {
  const cacheKey = modelCacheKey(orgId, entityType);

  const cached = await redis.get(cacheKey);
  if (cached) {
    try {
      return JSON.parse(cached) as ModelArtifact;
    } catch {
      // Corrupted cache entry — fall through to DB lookup
    }
  }

  const dbModel = await prisma.predictiveModel.findFirst({
    where: { orgId, entityType, isActive: true },
    orderBy: { trainedAt: 'desc' },
  });

  if (!dbModel) return null;

  const artifact = await loadModelFromS3(dbModel.modelArtifactS3Key);
  if (!artifact) return null;

  await redis.setex(cacheKey, MODEL_CACHE_TTL_S, JSON.stringify(artifact));
  return artifact;
}

// ─── Score invalidation ───────────────────────────────────────────────────

/**
 * Called from lead/opp update routes to bust the cached score.
 * WHY not automatic: keeping score invalidation explicit avoids hidden
 * coupling between the scoring cache and the update pipeline.
 */
export async function invalidateEntityScore(
  orgId: string,
  entityType: 'lead' | 'opportunity',
  entityId: string,
  redis: Redis,
): Promise<void> {
  await redis.del(scoreCacheKey(orgId, entityType, entityId));
}

// ─── Recommendation generator ─────────────────────────────────────────────

/** Generates a human-readable recommendation from the top factors. */
function buildRecommendation(
  winProb: number,
  factors: ScoreFactor[],
  recentDropPercent: number,
): string {
  const topNegative = factors.filter((f) => f.contribution < 0)[0];
  if (recentDropPercent >= 20) {
    return `⚠ Win probability has dropped ${recentDropPercent.toFixed(0)}% recently. ${topNegative ? `Address weak signal: ${topNegative.feature}.` : 'Review deal health urgently.'}`;
  }
  if (winProb >= 75) return 'Strong deal — maintain momentum and target close.';
  if (winProb >= 50) {
    return topNegative
      ? `Promising. Improve ${topNegative.feature.replace(/_/g, ' ')} to accelerate.`
      : 'On track — keep engagement high.';
  }
  if (winProb >= 25) {
    return topNegative
      ? `At risk. Focus on: ${topNegative.feature.replace(/_/g, ' ')}.`
      : 'Needs attention — re-qualify with stakeholders.';
  }
  return 'Low win probability. Consider re-qualifying or escalating.';
}

// ─── Lead scoring ─────────────────────────────────────────────────────────

export async function scoreLead(
  orgId: string,
  leadId: string,
  redis: Redis,
): Promise<LeadScoreResult> {
  const cacheKey = scoreCacheKey(orgId, 'lead', leadId);
  const cached = await redis.get(cacheKey);
  if (cached) {
    try {
      return JSON.parse(cached) as LeadScoreResult;
    } catch {
      // Fall through
    }
  }

  const model = await loadActiveModel(orgId, 'lead', redis);
  const featureVector = await extractLeadFeatures(leadId, orgId);

  const scoredAt = new Date().toISOString();
  // scoreBp is the canonical persisted value (basis points, 0–10000).
  // Fallback when no model: 0.5 probability → 5000 bp.
  let scoreBp = probabilityToBasisPoints(0.5);
  let factors: ScoreFactor[] = [];
  let modelVersion = 'fallback-v0';

  if (model && featureVector) {
    // Prefer XGBoost when a trained model is present; fall back to LR.
    const xgbProb = model.xgboost
      ? inferXgboostScore(model.xgboost.modelJson, featureVector.values)
      : null;
    const prob = xgbProb ?? inferScore(model, featureVector.values);
    scoreBp = probabilityToBasisPoints(prob);
    factors = (
      xgbProb !== null
        ? xgboostShapProxy(model, featureVector.values)
        : shapAttributions(model, featureVector.values)
    ).slice(0, 5);
    modelVersion = xgbProb !== null ? `${model.version}+xgb` : model.version;
  }

  // Persist to DB (upsert on orgId+entityType+entityId), in canonical basis points
  await prisma.predictiveScore.upsert({
    where: {
      // Prisma requires a unique constraint — use compound index semantics
      // via findFirst + update fallback since schema uses @@index not @@unique
      id:
        (
          await prisma.predictiveScore.findFirst({
            where: { orgId, targetType: 'lead', targetId: leadId },
            select: { id: true },
          })
        )?.id ?? '00000000-0000-0000-0000-000000000000',
    },
    update: {
      score: scoreBp,
      features: factors as object[],
      modelVersion,
      expiresAt: new Date(Date.now() + SCORE_CACHE_TTL_S * 1000),
    },
    create: {
      orgId,
      targetType: 'lead',
      targetId: leadId,
      kind: 'lead_score',
      score: scoreBp,
      features: factors as object[],
      modelVersion,
      expiresAt: new Date(Date.now() + SCORE_CACHE_TTL_S * 1000),
    },
  });

  // Public API contract is 0–100 (see LeadScoreResponse in routes/predictive-scoring.ts).
  const result: LeadScoreResult = {
    score: basisPointsToPercent(scoreBp),
    factors,
    modelVersion,
    scoredAt,
  };
  await redis.setex(cacheKey, SCORE_CACHE_TTL_S, JSON.stringify(result));
  return result;
}

// ─── Opportunity scoring ──────────────────────────────────────────────────

export async function scoreOpportunity(
  orgId: string,
  opportunityId: string,
  redis: Redis,
): Promise<OppScoreResult> {
  const cacheKey = scoreCacheKey(orgId, 'opportunity', opportunityId);
  const cached = await redis.get(cacheKey);
  if (cached) {
    try {
      return JSON.parse(cached) as OppScoreResult;
    } catch {
      // Fall through
    }
  }

  const model = await loadActiveModel(orgId, 'opportunity', redis);
  const featureVector = await extractOpportunityFeatures(opportunityId, orgId);

  const scoredAt = new Date().toISOString();
  // winProbabilityBp is the canonical persisted value (basis points, 0–10000).
  let winProbabilityBp = probabilityToBasisPoints(0.5);
  let factors: ScoreFactor[] = [];
  let modelVersion = 'fallback-v0';

  if (model && featureVector) {
    // Prefer XGBoost when a trained model is present; fall back to LR.
    const xgbProb = model.xgboost
      ? inferXgboostScore(model.xgboost.modelJson, featureVector.values)
      : null;
    const prob = xgbProb ?? inferScore(model, featureVector.values);
    winProbabilityBp = probabilityToBasisPoints(prob);
    factors = (
      xgbProb !== null
        ? xgboostShapProxy(model, featureVector.values)
        : shapAttributions(model, featureVector.values)
    ).slice(0, 5);
    modelVersion = xgbProb !== null ? `${model.version}+xgb` : model.version;
  }

  // Public 0–100 win probability (see OppScoreResponse in routes/predictive-scoring.ts).
  const winProbability = basisPointsToPercent(winProbabilityBp);

  // Check for score degradation vs 7d ago for notification trigger
  const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000);
  const previousScore = await prisma.predictiveScore.findFirst({
    where: {
      orgId,
      targetType: 'opportunity',
      targetId: opportunityId,
      createdAt: { lte: sevenDaysAgo },
      kind: 'win_probability',
    },
    orderBy: { createdAt: 'desc' },
    select: { score: true },
  });

  // Both operands are now canonical basis points: previousScore.score is read
  // from the same column this path writes (winProbabilityBp). recentDropPercent
  // is expressed in percentage points for human-facing copy + the >=20 guard.
  const recentDropPercent = previousScore
    ? degradationPercentPoints(previousScore.score, winProbabilityBp)
    : 0;

  // Predict close date using current velocity (linear extrapolation)
  const opp = await prisma.opportunity.findFirst({
    where: { id: opportunityId, orgId },
    select: { dueDate: true },
  });
  const predictedCloseDate = opp?.dueDate?.toISOString() ?? null;

  const recommendation = buildRecommendation(winProbability, factors, recentDropPercent);

  // Upsert score record
  const existingScore = await prisma.predictiveScore.findFirst({
    where: { orgId, targetType: 'opportunity', targetId: opportunityId, kind: 'win_probability' },
    select: { id: true },
  });

  await prisma.predictiveScore.upsert({
    where: {
      id: existingScore?.id ?? '00000000-0000-0000-0000-000000000000',
    },
    update: {
      score: winProbabilityBp,
      features: factors as object[],
      modelVersion,
      recommendedAction: recommendation,
      expiresAt: new Date(Date.now() + SCORE_CACHE_TTL_S * 1000),
    },
    create: {
      orgId,
      targetType: 'opportunity',
      targetId: opportunityId,
      kind: 'win_probability',
      score: winProbabilityBp,
      features: factors as object[],
      modelVersion,
      recommendedAction: recommendation,
      expiresAt: new Date(Date.now() + SCORE_CACHE_TTL_S * 1000),
    },
  });

  // Trigger degradation notification if score dropped >= the threshold (20 pts) in 7 days
  if (recentDropPercent >= DEGRADATION_THRESHOLD_BP / BP_PER_PERCENT) {
    log.info(
      { orgId, opportunityId, recentDropPercent },
      'opportunity score degraded — firing notification',
    );
    await fireDegradationNotification(orgId, opportunityId, winProbability, recentDropPercent);
  }

  const result: OppScoreResult = {
    winProbability,
    predictedCloseDate,
    factors,
    recommendation,
    modelVersion,
    scoredAt,
  };
  await redis.setex(cacheKey, SCORE_CACHE_TTL_S, JSON.stringify(result));
  return result;
}

// ─── Degradation notification ─────────────────────────────────────────────

/**
 * Fires a W3-2-compatible in-app notification when an opportunity score
 * drops > 20 points within 7 days.
 *
 * WHY fanOutWebhookEvent not a direct DB insert:
 *   The webhook fan-out pipeline already handles notification routing to
 *   Slack, email, and in-app channels. Reusing it avoids duplication.
 */
async function fireDegradationNotification(
  orgId: string,
  opportunityId: string,
  currentScore: number,
  dropPercent: number,
): Promise<void> {
  try {
    const { fanOutWebhookEvent } = await import('../queues/webhook-delivery.js');
    await fanOutWebhookEvent(orgId, 'opportunity.score_degraded', {
      opportunityId,
      winProbability: currentScore,
      dropPercent: Math.round(dropPercent),
      message: `Deal is degrading — win probability dropped ${Math.round(dropPercent)}% in the last 7 days.`,
    });
  } catch (err) {
    // WHY non-fatal: notification failure must not break score computation
    log.warn({ err, orgId, opportunityId }, 'degradation notification failed — non-fatal');
  }
}
