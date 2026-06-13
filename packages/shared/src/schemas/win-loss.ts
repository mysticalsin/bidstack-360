// Win/Loss reason capture + pattern flagging. Managers record WHY a deal closed
// (won/lost) so the tool can surface patterns ("losing because too expensive").
// Manual capture today; a future OM connector can backfill.
import { z } from 'zod';

export const WinLossOutcome = z.enum(['won', 'lost']);
export type WinLossOutcome = z.infer<typeof WinLossOutcome>;

export const WinLossReasonCode = z.enum([
  'price',
  'product_fit',
  'timing',
  'competitor',
  'relationship',
  'scope',
  'no_decision',
  'other',
]);
export type WinLossReasonCode = z.infer<typeof WinLossReasonCode>;

export const WinLossRecord = z.object({
  id: z.string().uuid(),
  opportunityId: z.string().uuid(),
  outcome: WinLossOutcome,
  reason: WinLossReasonCode,
  competitor: z.string().max(255).nullable(),
  note: z.string().max(4000).nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type WinLossRecord = z.infer<typeof WinLossRecord>;

// Upsert (one record per opportunity). competitor only meaningful when the
// reason is "competitor", but allowed alongside any reason.
export const WinLossRecordUpsert = z.object({
  outcome: WinLossOutcome,
  reason: WinLossReasonCode,
  competitor: z.string().max(255).nullable().optional(),
  note: z.string().max(4000).nullable().optional(),
});
export type WinLossRecordUpsert = z.infer<typeof WinLossRecordUpsert>;

// Pattern flagging: counts per reason split by outcome, plus the dominant loss
// reason the UI highlights.
export const WinLossPatternRow = z.object({
  reason: WinLossReasonCode,
  outcome: WinLossOutcome,
  count: z.number().int().nonnegative(),
});
export type WinLossPatternRow = z.infer<typeof WinLossPatternRow>;

export const WinLossPatterns = z.object({
  rows: z.array(WinLossPatternRow),
  totalWon: z.number().int().nonnegative(),
  totalLost: z.number().int().nonnegative(),
  topLossReason: WinLossReasonCode.nullable(),
});
export type WinLossPatterns = z.infer<typeof WinLossPatterns>;
