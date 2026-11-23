import { z } from 'zod';

export const BidScoreCriterion = z.object({
  id: z.string(),
  value: z.number().int().min(0).max(5),
});

export const BidScoreCriteria = z.record(z.string(), z.number().int().min(0).max(5));

export const BidScoreCategory = z.enum(['strategic', 'technical', 'commercial', 'risk']);

export const BidScoreRecommendation = z.enum(['bid', 'no_bid', 'proceed_with_caution']);

/** 'follow' = accept the computed recommendation; 'override' = proceed with the bid anyway. */
export const BidScoreDecision = z.enum(['follow', 'override']);

/** Mandatory acknowledgement + justification when proceeding against a below-threshold recommendation. */
export const BidScoreOverride = z.object({
  acknowledged: z.literal(true),
  justification: z.string().min(30).max(5000),
});

export const BidScoreCreate = z.object({
  opportunityId: z.string().guid(),
  criteria: BidScoreCriteria,
  notes: z.string().max(5000).optional(),
  decision: BidScoreDecision.optional().default('follow'),
  override: BidScoreOverride.optional(),
});

export const BidScoreUpdate = z.object({
  criteria: BidScoreCriteria,
  notes: z.string().max(5000).optional(),
});

export const BidScoreItem = z.object({
  id: z.string().guid(),
  opportunityId: z.string().guid(),
  scoredBy: z.string().guid(),
  version: z.number().int(),
  criteria: BidScoreCriteria,
  totalScore: z.number().int(),
  categoryScores: z.record(z.string(), z.number()),
  weightedSum: z.number(),
  totalWeight: z.number(),
  aiSuggested: z.boolean(),
  memosPolicies: z.array(z.string().guid()),
  recommendation: BidScoreRecommendation,
  notes: z.string().nullable(),
  // Below-threshold override audit trail (director/VP visibility surface).
  overrideJustification: z.string().nullable(),
  overriddenBy: z.string().guid().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const BidScoreList = z.object({
  items: z.array(BidScoreItem),
});

export const BidScoreFilter = z.object({
  opportunityId: z.string().guid().optional(),
  recommendation: BidScoreRecommendation.optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

export const BidScoreAICalibrate = z.object({
  opportunityId: z.string().guid(),
});

export const BidScoreAICalibrateResponse = z.object({
  criteria: BidScoreCriteria,
  totalScore: z.number().int(),
  categoryScores: z.record(z.string(), z.number()),
  recommendation: BidScoreRecommendation,
  reasoning: z.string(),
  memosPolicies: z.array(z.string().guid()),
});

export const BidScoreDefendResponse = z.object({
  reasoning: z.string(),
  sources: z.array(z.string()),
});
