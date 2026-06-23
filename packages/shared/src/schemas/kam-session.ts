/**
 * kam-session.ts — KAM workshop sessions + the human-gate staging draft.
 *
 * Flow (5-step KAM method, steps 4→5): a session holds a transcript; an
 * AI-organized DRAFT (note + extracted to-do + surfaced initiatives) lands in
 * KamSessionDraft (status 'pending'); a HUMAN edits and approves; ONLY on
 * approval does anything commit to live data. Nothing here auto-commits.
 *
 * The draft's organized content is produced by the Dust MCP tool, a worker
 * organize job, or typed manually — this module is the staging + gate contract,
 * agnostic to how the draft got filled.
 */
import { z } from 'zod';

export const KAM_SESSION_SOURCES = [
  'manual_paste',
  'manual_upload',
  'sharepoint_pull',
  'call_recording',
  'dust_push',
] as const;

export const KamSessionCreate = z.object({
  companyId: z.string().uuid(),
  title: z.string().max(300).optional(),
  heldAt: z.string().datetime(),
  sourceType: z.enum(KAM_SESSION_SOURCES),
  sourceRef: z.string().max(2000).optional(),
  attendees: z.array(z.string().max(200)).max(100).optional(),
  consultantIds: z.array(z.string().uuid()).max(100).optional(),
  transcriptText: z.string().max(500_000).optional(),
});
export type KamSessionCreate = z.infer<typeof KamSessionCreate>;

export const KamSessionDetail = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  title: z.string().nullable(),
  heldAt: z.string(),
  sourceType: z.enum(KAM_SESSION_SOURCES),
  sourceRef: z.string().nullable(),
  attendees: z.array(z.string()),
  consultantIds: z.array(z.string()),
  hasTranscript: z.boolean(),
  aiNote: z.unknown().nullable(),
  aiNoteStatus: z.enum(['pending', 'approved', 'rejected']),
  committedAt: z.string().nullable(),
  createdAt: z.string(),
});
export type KamSessionDetail = z.infer<typeof KamSessionDetail>;

export const KamSessionList = z.object({ items: z.array(KamSessionDetail) });

// ─── Draft content shapes (AI output / human edits) ─────────────────────────

/** The skimmable organized note the manager reads. */
export const KamNoteDraft = z.object({
  summary: z.string().max(10_000).default(''),
  keyPoints: z.array(z.string().max(2000)).max(100).default([]),
  decisions: z.array(z.string().max(2000)).max(100).default([]),
  attendees: z.array(z.string().max(200)).max(100).default([]),
});

/** A new initiative surfaced by the workshop (draft → created on approve). */
export const KamInitiativeDraftItem = z.object({
  title: z.string().min(1).max(300),
  description: z.string().max(5000).optional(),
  priority: z.enum(['low', 'medium', 'high', 'critical']).optional(),
});

/** An extracted to-do, linked to one of the draft's initiatives by index. */
export const KamTaskDraftItem = z.object({
  title: z.string().min(1).max(300),
  type: z.enum(['prospection', 'follow_up', 'proposal_prep', 'internal', 'other']).optional(),
  dueDate: z.string().datetime().optional(),
  /** Index into initiativeDrafts — which initiative this task belongs to. */
  initiativeIndex: z.number().int().min(0),
});

/** A garbled proper noun flagged for human correction (never guessed). */
export const KamLowConfidenceItem = z.object({
  term: z.string().max(500),
  context: z.string().max(2000).optional(),
});

export const KamDraftContent = z.object({
  noteDraft: KamNoteDraft,
  initiativeDrafts: z.array(KamInitiativeDraftItem).max(50).default([]),
  taskDrafts: z.array(KamTaskDraftItem).max(150).default([]),
  lowConfidence: z.array(KamLowConfidenceItem).max(100).default([]),
});
export type KamDraftContent = z.infer<typeof KamDraftContent>;

/** Create a staging draft for a session (organized content optional — a human
 *  or the MCP tool can fill it later via PATCH). source: manual | dust_mcp | ai_pipeline. */
export const KamSessionDraftCreate = z.object({
  source: z.enum(['manual', 'dust_mcp', 'ai_pipeline']).default('manual'),
  content: KamDraftContent.partial().optional(),
});

export const KamSessionDraftPatch = z.object({
  content: KamDraftContent.partial(),
});

export const KamSessionDraftDetail = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  sessionId: z.string().uuid(),
  status: z.enum(['pending', 'approved', 'rejected']),
  source: z.string(),
  noteDraft: z.unknown(),
  initiativeDrafts: z.unknown(),
  taskDrafts: z.unknown(),
  lowConfidence: z.unknown(),
  reviewedById: z.string().uuid().nullable(),
  reviewedAt: z.string().nullable(),
  createdAt: z.string(),
});
export type KamSessionDraftDetail = z.infer<typeof KamSessionDraftDetail>;

/** Result of approving a draft — the canonical rows it committed. */
export const KamDraftApproveResult = z.object({
  sessionId: z.string().uuid(),
  createdInitiativeIds: z.array(z.string().uuid()),
  createdTaskIds: z.array(z.string().uuid()),
});
