import { z } from 'zod';

export const BidScoreCriterion = z.object({
  id: z.string(),
  value: z.number().int().min(0).max(5),
});

export const BidScoreCriteria = z.record(z.number().int().min(0).max(5));

export const BidScoreCategory = z.enum(['strategic', 'technical', 'commercial', 'risk']);

export const BidScoreRecommendation = z.enum(['bid', 'no_bid', 'proceed_with_caution']);

export const BidScoreCreate = z.object({
  opportunityId: z.string().uuid(),
  criteria: BidScoreCriteria,
  notes: z.string().max(5000).optional(),
});

export const BidScoreUpdate = z.object({
  criteria: BidScoreCriteria,
  notes: z.string().max(5000).optional(),
});

export const BidScoreItem = z.object({
  id: z.string().uuid(),
  opportunityId: z.string().uuid(),
  scoredBy: z.string().uuid(),
  version: z.number().int(),
  criteria: BidScoreCriteria,
  totalScore: z.number().int(),
  categoryScores: z.record(z.number()),
  weightedSum: z.number(),
  totalWeight: z.number(),
  aiSuggested: z.boolean(),
  memosPolicies: z.array(z.string().uuid()),
  recommendation: BidScoreRecommendation,
  notes: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const BidScoreList = z.object({
  items: z.array(BidScoreItem),
});

export const BidScoreFilter = z.object({
  opportunityId: z.string().uuid().optional(),
  recommendation: BidScoreRecommendation.optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

export const BidScoreAICalibrate = z.object({
  opportunityId: z.string().uuid(),
});

export const BidScoreAICalibrateResponse = z.object({
  criteria: BidScoreCriteria,
  totalScore: z.number().int(),
  categoryScores: z.record(z.number()),
  recommendation: BidScoreRecommendation,
  reasoning: z.string(),
  memosPolicies: z.array(z.string().uuid()),
});

export const BidScoreDefendResponse = z.object({
  reasoning: z.string(),
  sources: z.array(z.string()),
});
