import { z } from 'zod';

import { LeadStatus } from './leads.js';

/**
 * Sprint 1 — Krayin import.
 * Per-status defaults for how many days a Lead may sit before the kanban
 * shows a "Rotten Days" badge. Org-level overrides live in the
 * LeadStageRotConfig table; missing rows fall back to these defaults.
 *
 * Defaults are intentionally generous: a brand-new lead has 7 days, a
 * "nurture" lead has 30, "disqualified" and "converted" never rot
 * (rottenDays: null disables the badge for that status).
 */
export const LEAD_ROT_DEFAULTS: Record<z.infer<typeof LeadStatus>, number | null> = {
  new: 7,
  contacted: 14,
  qualified: 21,
  nurture: 30,
  disqualified: null,
  converted: null,
};

export const LeadStageRotConfig = z.object({
  id: z.string().uuid(),
  orgId: z.string().uuid(),
  status: LeadStatus,
  rottenDays: z.number().int().min(0).max(365),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type LeadStageRotConfig = z.infer<typeof LeadStageRotConfig>;

export const LeadStageRotConfigUpsert = z.object({
  status: LeadStatus,
  rottenDays: z.number().int().min(0).max(365),
});
export type LeadStageRotConfigUpsert = z.infer<typeof LeadStageRotConfigUpsert>;

export const LeadStageRotConfigList = z.object({
  items: z.array(LeadStageRotConfig),
});
export type LeadStageRotConfigList = z.infer<typeof LeadStageRotConfigList>;

/**
 * AI recovery play suggestion. Returned per-rotten-lead by
 * POST /v1/leads/:id/recovery-suggest. Replaces "what should I do with
 * this stale lead?" with a one-click action.
 */
export const RecoveryPlayKind = z.enum([
  'send_reengagement_email',
  'schedule_call',
  'add_to_nurture',
  'mark_lost',
]);
export type RecoveryPlayKind = z.infer<typeof RecoveryPlayKind>;

export const RecoveryPlay = z.object({
  kind: RecoveryPlayKind,
  rationale: z.string().max(280),
  /** Optional one-click hint payload (e.g. emailTemplateId for re-engagement). */
  payload: z.record(z.unknown()).default({}),
  confidence: z.number().min(0).max(1),
});
export type RecoveryPlay = z.infer<typeof RecoveryPlay>;

export const RecoverySuggestResponse = z.object({
  leadId: z.string().uuid(),
  daysInStage: z.number().int().nonnegative(),
  rottenDays: z.number().int().nonnegative().nullable(),
  isRotten: z.boolean(),
  plays: z.array(RecoveryPlay).max(4),
});
export type RecoverySuggestResponse = z.infer<typeof RecoverySuggestResponse>;
