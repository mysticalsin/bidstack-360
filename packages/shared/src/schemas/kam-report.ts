/**
 * kam-report.ts — KAM KPI roll-ups + the prospection read-mirror.
 *
 * KPIs (brief): per account (initiatives by stage, open/done tasks, prospection
 * count, last activity, stale count); per owner (prospections done, initiatives
 * worked vs untouched); per country (VP roll-up); staleness alert.
 *
 * Prospections are READ FROM ABC (the system of record) — never rebuilt here.
 * KamProspection is a read-mirror populated by the ABC connector or manual
 * import; KPIs count only non-deleted mirror rows.
 */
import { z } from 'zod';

// ─── KPIs ─────────────────────────────────────────────────────────────────

export const KamAccountKpi = z.object({
  companyId: z.string().uuid(),
  initiativesByStage: z.object({
    initiative: z.number().int(),
    lead: z.number().int(),
    opportunity: z.number().int(),
    dropped: z.number().int(),
  }),
  openTasks: z.number().int(),
  doneTasks: z.number().int(),
  prospectionCount: z.number().int(),
  lastActivityAt: z.string().nullable(),
  staleInitiativeCount: z.number().int(),
});
export type KamAccountKpi = z.infer<typeof KamAccountKpi>;

export const KamOwnerKpi = z.object({
  ownerId: z.string().uuid().nullable(),
  ownerName: z.string().nullable(),
  prospectionsDone: z.number().int(),
  initiativesWorked: z.number().int(),
  initiativesUntouched: z.number().int(),
});

export const KamOwnerKpiList = z.object({
  staleDays: z.number().int(),
  items: z.array(KamOwnerKpi),
});

export const KamCountryRollupItem = z.object({
  country: z.string().nullable(),
  accounts: z.number().int(),
  initiatives: z.number().int(),
  openOpportunities: z.number().int(),
  prospections: z.number().int(),
});

export const KamRollup = z.object({ items: z.array(KamCountryRollupItem) });

export const KamStaleInitiative = z.object({
  id: z.string().uuid(),
  title: z.string(),
  companyId: z.string().uuid(),
  stage: z.enum(['initiative', 'lead', 'opportunity', 'dropped']),
  lastActivityAt: z.string(),
  daysStale: z.number().int(),
});

export const KamStaleList = z.object({
  staleDays: z.number().int(),
  items: z.array(KamStaleInitiative),
});

// ─── Prospection mirror (read from ABC) ─────────────────────────────────────

export const KamProspectionImportRow = z.object({
  externalId: z.string().max(200).optional(),
  companyId: z.string().uuid().optional(),
  ownerId: z.string().uuid().optional(),
  actionType: z.string().min(1).max(100),
  occurredAt: z.string().datetime(),
  linkedTaskId: z.string().uuid().optional(),
  linkedInitiativeId: z.string().uuid().optional(),
});

/** Bulk import / mirror sync from ABC. source='abc' rows MUST carry externalId
 *  (the ABC id); manual rows are keyed by a generated UUID. orgId is stamped
 *  server-side from the caller — never trusted from the payload. */
export const KamProspectionImportBody = z.object({
  source: z.enum(['abc', 'manual']).default('abc'),
  syncBatchId: z.string().max(100).optional(),
  rows: z.array(KamProspectionImportRow).min(1).max(1000),
});

export const KamProspectionImportResult = z.object({
  imported: z.number().int(),
  skipped: z.number().int(),
  reconciledOut: z.number().int(),
});

export const KamProspectionDetail = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid().nullable(),
  ownerId: z.string().uuid().nullable(),
  externalId: z.string().nullable(),
  actionType: z.string(),
  occurredAt: z.string(),
  source: z.string(),
  syncedAt: z.string(),
});

export const KamProspectionList = z.object({ items: z.array(KamProspectionDetail) });
