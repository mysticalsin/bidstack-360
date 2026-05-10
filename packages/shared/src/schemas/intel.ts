import { z } from 'zod';

export const TriggerKind = z.enum([
  'funding',
  'regulatory',
  'executive_move',
  'tech_adoption',
  'deal_activity',
  'hiring',
  'press',
  'other',
]);

export const Trigger = z.object({
  id: z.string(),
  kind: TriggerKind,
  label: z.string(),
  weight: z.number().min(0).max(10),
  observedAt: z.string().datetime(),
  source: z.string().nullable(),
});
export type Trigger = z.infer<typeof Trigger>;

export const Financial = z.object({
  ticker: z.string().nullable(),
  marketCap: z.number().nullable(),
  revenueAnnual: z.number().nullable(),
  revenueGrowth: z.number().nullable(),
  ebitdaMargin: z.number().nullable(),
  creditRating: z.string().nullable(),
  headcount: z.number().int().nullable(),
  headcountTrend: z.array(z.object({ date: z.string(), n: z.number().int() })),
  pricePoints: z.array(z.number()),
});
export type Financial = z.infer<typeof Financial>;

export const DecisionMember = z.object({
  contactId: z.string().uuid(),
  name: z.string(),
  role: z.string(),
  influence: z.number().min(0).max(1),
  sentiment: z.enum(['hot', 'warm', 'neutral', 'cold']),
  power: z.enum(['decision', 'champion', 'influencer', 'gatekeeper', 'approver']),
});
export type DecisionMember = z.infer<typeof DecisionMember>;

export const Competitor = z.object({
  vendor: z.string(),
  score: z.number().min(0).max(100),
  strengths: z.array(z.string()),
  weaknesses: z.array(z.string()),
});
export type Competitor = z.infer<typeof Competitor>;

export const NewsItem = z.object({
  id: z.string(),
  headline: z.string(),
  source: z.string(),
  publishedAt: z.string().datetime(),
  sentiment: z.enum(['positive', 'neutral', 'negative']),
  url: z.string().url().nullable(),
});
export type NewsItem = z.infer<typeof NewsItem>;

export const HiringSignal = z.object({
  openings: z.array(
    z.object({
      title: z.string(),
      department: z.string(),
      urgency: z.enum(['low', 'medium', 'high']),
      postedAt: z.string().datetime(),
    }),
  ),
  velocity: z.number(),
  trendDirection: z.enum(['up', 'down', 'flat']),
});
export type HiringSignal = z.infer<typeof HiringSignal>;

export const WinPrediction = z.object({
  probability: z.number().int().min(0).max(100),
  modelVersion: z.string(),
  drivers: z.array(
    z.object({
      label: z.string(),
      contribution: z.number(),
    }),
  ),
});
export type WinPrediction = z.infer<typeof WinPrediction>;

export const IntelPayload = z.object({
  financial: Financial.nullable(),
  triggers: z.array(Trigger),
  decisionUnit: z.array(DecisionMember),
  competitors: z.array(Competitor),
  news: z.array(NewsItem),
  hiring: HiringSignal.nullable(),
  winPrediction: WinPrediction.nullable(),
  refreshedAt: z.string().datetime(),
});
export type IntelPayload = z.infer<typeof IntelPayload>;
