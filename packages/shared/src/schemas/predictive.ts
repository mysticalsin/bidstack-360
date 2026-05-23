import { z } from 'zod';

export const PredictiveScoreKind = z.enum([
  'win_probability',
  'churn_risk',
  'deal_velocity',
  'optimal_price',
  'lead_score',
  'next_best_action',
]);
export type PredictiveScoreKind = z.infer<typeof PredictiveScoreKind>;

export const PredictiveScore = z.object({
  id: z.string().uuid(),
  targetType: z.string().max(50),
  targetId: z.string().uuid(),
  kind: PredictiveScoreKind,
  score: z.number().int().min(0).max(10000),
  confidence: z.number().int().min(0).max(10000),
  features: z.record(z.unknown()).default({}),
  modelVersion: z.string(),
  recommendedAction: z.string().nullable(),
  expiresAt: z.string().datetime(),
  createdAt: z.string().datetime(),
});
export type PredictiveScore = z.infer<typeof PredictiveScore>;

export const PredictiveScoreFilter = z.object({
  targetType: z.string().optional(),
  targetId: z.string().uuid().optional(),
  kind: PredictiveScoreKind.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type PredictiveScoreFilter = z.infer<typeof PredictiveScoreFilter>;
