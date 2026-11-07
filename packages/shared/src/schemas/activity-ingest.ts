// Inbound activity API (POST /api/v1/ingest/activities and the MCP tool
// activities_ingest). An external CRM, an opportunity tool or Dust pushes calls,
// emails, meetings, notes and stage changes; externalSource + externalId is the
// dedupe key, so a replay updates or skips instead of duplicating.

import { z } from 'zod';

export const INGEST_MAX_BATCH = 500;

export const IngestActivityType = z.enum(['call', 'email', 'meeting', 'note', 'stage_change']);
export type IngestActivityType = z.infer<typeof IngestActivityType>;

const externalKey = z.string().trim().min(1).max(200);

export const IngestCompanyRef = z
  .object({
    id: z.string().uuid().optional(),
    domain: z.string().trim().min(3).max(253).optional(),
    externalId: externalKey.optional(),
  })
  .strict()
  .refine((ref) => Boolean(ref.id || ref.domain || ref.externalId), {
    message: 'company needs an id, a domain or an externalId',
  });

export const IngestOpportunityRef = z
  .object({
    id: z.string().uuid().optional(),
    code: z.string().trim().min(1).max(40).optional(),
    externalId: externalKey.optional(),
  })
  .strict()
  .refine((ref) => Boolean(ref.id || ref.code || ref.externalId), {
    message: 'opportunity needs an id, a code or an externalId',
  });

export const IngestParticipant = z
  .object({
    email: z.string().trim().email().max(320).optional(),
    name: z.string().trim().max(200).optional(),
  })
  .strict();

export const IngestActivity = z
  .object({
    externalSource: z
      .string()
      .trim()
      .min(1)
      .max(40)
      .regex(/^[a-z0-9][a-z0-9._-]*$/i, 'letters, digits, dot, dash or underscore'),
    externalId: externalKey,
    type: IngestActivityType,
    occurredAt: z.string().datetime({ offset: true }),
    status: z.enum(['planned', 'completed', 'cancelled']).optional(),
    /** When a planned follow-up falls due. Past and still planned = overdue. */
    dueAt: z.string().datetime({ offset: true }).optional(),
    subject: z.string().max(500).optional(),
    description: z.string().max(10_000).optional(),
    durationMinutes: z.number().int().min(0).max(1440).optional(),
    direction: z.enum(['inbound', 'outbound']).optional(),
    stage: z
      .object({ from: z.string().trim().max(60).optional(), to: z.string().trim().min(1).max(60) })
      .strict()
      .optional(),
    company: IngestCompanyRef.optional(),
    opportunity: IngestOpportunityRef.optional(),
    participants: z.array(IngestParticipant).max(50).optional(),
  })
  .strict()
  .superRefine((item, ctx) => {
    if (!item.company && !item.opportunity) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'an activity needs a company or an opportunity',
        path: ['company'],
      });
    }
    if (item.type === 'stage_change' && !item.stage) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'a stage change needs stage.to',
        path: ['stage'],
      });
    }
  });
export type IngestActivity = z.infer<typeof IngestActivity>;

export const IngestActivitiesRequest = z.object({
  activities: z.array(IngestActivity).min(1).max(INGEST_MAX_BATCH),
});
export type IngestActivitiesRequest = z.infer<typeof IngestActivitiesRequest>;

export const IngestSkipReason = z.enum([
  'company_not_found',
  'opportunity_not_found',
  'out_of_scope',
  'company_mismatch',
  'duplicate_in_batch',
  'unchanged',
]);
export type IngestSkipReason = z.infer<typeof IngestSkipReason>;

const IngestItemRef = z.object({
  index: z.number().int().min(0),
  externalSource: z.string(),
  externalId: z.string(),
});

export const IngestActivitiesResponse = z.object({
  counts: z.object({
    accepted: z.number().int().min(0),
    updated: z.number().int().min(0),
    skipped: z.number().int().min(0),
  }),
  accepted: z.array(IngestItemRef.extend({ activityId: z.string().uuid() })),
  updated: z.array(IngestItemRef.extend({ activityId: z.string().uuid() })),
  skipped: z.array(IngestItemRef.extend({ reason: IngestSkipReason })),
});
export type IngestActivitiesResponse = z.infer<typeof IngestActivitiesResponse>;

// ─── Account activity summary (GET /api/v1/companies/:id/activity-summary) ──

export const ACTIVITY_SUMMARY_DEFAULT_WEEKS = 12;
export const ACTIVITY_SUMMARY_MAX_WEEKS = 52;

const typeCounts = {
  call: z.number().int().min(0),
  email: z.number().int().min(0),
  meeting: z.number().int().min(0),
  note: z.number().int().min(0),
  stage_change: z.number().int().min(0),
};

export const CompanyActivitySummary = z.object({
  companyId: z.string().uuid(),
  timezone: z.string(),
  from: z.string().datetime(),
  to: z.string().datetime(),
  total: z.number().int().min(0),
  /** 24 rows, hour 0 to 23 in `timezone`. */
  byHour: z.array(z.object({ hour: z.number().int().min(0).max(23), ...typeCounts })),
  /** Oldest week first; weekStart is the Monday (YYYY-MM-DD) in `timezone`. */
  weekly: z.array(
    z.object({
      weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      ...typeCounts,
      overdue: z.number().int().min(0),
    }),
  ),
  overdue: z.object({
    count: z.number().int().min(0),
    oldestDueAt: z.string().datetime().nullable(),
  }),
});
export type CompanyActivitySummary = z.infer<typeof CompanyActivitySummary>;

// ─── Sync now (one pattern for every source) ───────────────────────────────

export const SyncSource = z.enum(['dust', 'hubspot']);
export type SyncSource = z.infer<typeof SyncSource>;

export const SyncRun = z.object({
  runId: z.string(),
  source: SyncSource,
  state: z.enum(['queued', 'running', 'completed', 'failed']),
  progress: z.number().int().min(0).max(100),
  startedAt: z.string().datetime().nullable(),
  finishedAt: z.string().datetime().nullable(),
  result: z
    .object({
      new: z.number().int().min(0),
      updated: z.number().int().min(0),
      skipped: z.number().int().min(0),
      failed: z.number().int().min(0),
    })
    .nullable(),
  reasons: z.array(z.string()),
});
export type SyncRun = z.infer<typeof SyncRun>;

export const SyncOverview = z.object({
  source: SyncSource,
  lastSyncedAt: z.string().datetime().nullable(),
  lastRun: SyncRun.nullable(),
});
export type SyncOverview = z.infer<typeof SyncOverview>;
