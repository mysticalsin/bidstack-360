/**
 * kam-initiative.ts — KAM Initiative schemas + the locked state machine.
 *
 * Vocabulary is LOCKED (do not rename): Initiative → Lead → Opportunity → Dropped.
 * The transition table is the single source of legal edges; the API guard and
 * the kanban board both consult it so illegal moves are rejected consistently.
 */
import { z } from 'zod';

export const INITIATIVE_STAGES = ['initiative', 'lead', 'opportunity', 'dropped'] as const;
export type InitiativeStageValue = (typeof INITIATIVE_STAGES)[number];

/**
 * Legal stage edges. `opportunity` and `dropped` are TERMINAL (no re-open in
 * v1): once an initiative hands off to OM or is dropped, it stays put. A move
 * not listed here is rejected with 409.
 */
export const ALLOWED_INITIATIVE_TRANSITIONS: Record<InitiativeStageValue, InitiativeStageValue[]> = {
  initiative: ['lead', 'dropped'],
  lead: ['opportunity', 'dropped'],
  opportunity: [],
  dropped: [],
};

export function isAllowedInitiativeTransition(
  from: InitiativeStageValue,
  to: InitiativeStageValue,
): boolean {
  if (from === to) return false;
  return ALLOWED_INITIATIVE_TRANSITIONS[from]?.includes(to) ?? false;
}

export const KAM_PRIORITIES = ['low', 'medium', 'high', 'critical'] as const;
const PriorityEnum = z.enum(KAM_PRIORITIES);

export const KamInitiativeCreate = z.object({
  companyId: z.string().uuid(),
  title: z.string().min(1).max(300),
  description: z.string().max(5000).optional(),
  sessionId: z.string().uuid().optional(),
  ownerId: z.string().uuid().optional(),
  priority: PriorityEnum.optional(),
  estimatedValueMicros: z.number().int().nonnegative().optional(),
});
export type KamInitiativeCreate = z.infer<typeof KamInitiativeCreate>;

export const KamInitiativePatch = z.object({
  title: z.string().min(1).max(300).optional(),
  description: z.string().max(5000).nullable().optional(),
  ownerId: z.string().uuid().nullable().optional(),
  priority: PriorityEnum.optional(),
  estimatedValueMicros: z.number().int().nonnegative().nullable().optional(),
});
export type KamInitiativePatch = z.infer<typeof KamInitiativePatch>;

/**
 * Transition request. `toStage` is validated against ALLOWED_INITIATIVE_TRANSITIONS
 * server-side. `droppedReason` is REQUIRED when toStage='dropped'. The opportunity
 * mint options apply only when toStage='opportunity'.
 */
export const KamInitiativeTransitionBody = z.object({
  toStage: z.enum(INITIATIVE_STAGES),
  droppedReason: z.string().max(2000).optional(),
  estimatedValueMicros: z.number().int().nonnegative().optional(),
  opportunityName: z.string().min(1).max(300).optional(),
  pipelineStageId: z.string().uuid().optional(),
});
export type KamInitiativeTransitionBody = z.infer<typeof KamInitiativeTransitionBody>;

export const KamInitiativeDetail = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  sessionId: z.string().uuid().nullable(),
  title: z.string(),
  description: z.string().nullable(),
  stage: z.enum(INITIATIVE_STAGES),
  ownerId: z.string().uuid().nullable(),
  priority: PriorityEnum,
  estimatedValueMicros: z.number().nullable(),
  lastActivityAt: z.string(),
  droppedReason: z.string().nullable(),
  convertedToOpportunityId: z.string().uuid().nullable(),
  handoffId: z.string().uuid().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type KamInitiativeDetail = z.infer<typeof KamInitiativeDetail>;

export const KamInitiativeList = z.object({
  items: z.array(KamInitiativeDetail),
  nextCursor: z.string().nullable(),
});
export type KamInitiativeList = z.infer<typeof KamInitiativeList>;
