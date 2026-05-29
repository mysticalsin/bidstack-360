// Lead "Rotten Days" routes — per-status configuration of the staleness
// threshold + an agent-stub endpoint for recovery play suggestions.

import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { prisma } from '@bidstack/db';
import {
  LEAD_ROT_DEFAULTS,
  LeadStageRotConfig,
  LeadStageRotConfigList,
  LeadStageRotConfigUpsert,
  LeadStatus,
  RecoverySuggestResponse,
  type RecoveryPlay,
} from '@bidstack/shared';

const IdParam = z.object({ id: z.string().uuid() });
const STATUS_VALUES = LeadStatus.options;

export const leadRotRoutes: FastifyPluginAsyncZod = async (server) => {
  // ─── GET /api/v1/lead-rot/config ──────────────────────────────────────
  // Returns one row per status, falling back to the static defaults when
  // the tenant hasn't overridden a particular status.
  server.get(
    '/lead-rot/config',
    {
      schema: { response: { 200: LeadStageRotConfigList } },
    },
    async (req) => {
      const rows = await prisma.leadStageRotConfig.findMany({
        where: { orgId: req.auth.orgId },
      });
      const byStatus = new Map(rows.map((r) => [r.status, r]));

      const items = STATUS_VALUES.flatMap((status) => {
        const override = byStatus.get(status);
        if (override) {
          return [
            {
              id: override.id,
              orgId: override.orgId,
              status: override.status,
              rottenDays: override.rottenDays,
              createdAt: override.createdAt.toISOString(),
              updatedAt: override.updatedAt.toISOString(),
            },
          ];
        }
        const fallback = LEAD_ROT_DEFAULTS[status];
        if (fallback === null) return [];
        // Use a deterministic placeholder id for unset rows so client-side
        // caching doesn't churn. We never round-trip this id to the DB.
        return [
          {
            id: `00000000-0000-0000-0000-${status.padStart(12, '0').slice(0, 12)}`,
            orgId: req.auth.orgId,
            status,
            rottenDays: fallback,
            createdAt: new Date(0).toISOString(),
            updatedAt: new Date(0).toISOString(),
          },
        ];
      });

      return { items };
    },
  );

  // ─── PUT /api/v1/lead-rot/config ──────────────────────────────────────
  // Upsert a per-status override. Used by Settings.
  server.put(
    '/lead-rot/config',
    {
      schema: {
        body: LeadStageRotConfigUpsert,
        response: { 200: LeadStageRotConfig },
      },
    },
    async (req) => {
      const row = await prisma.leadStageRotConfig.upsert({
        where: { orgId_status: { orgId: req.auth.orgId, status: req.body.status } },
        create: {
          orgId: req.auth.orgId,
          status: req.body.status,
          rottenDays: req.body.rottenDays,
        },
        update: { rottenDays: req.body.rottenDays },
      });
      return {
        id: row.id,
        orgId: row.orgId,
        status: row.status,
        rottenDays: row.rottenDays,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      };
    },
  );

  // ─── POST /api/v1/leads/:id/recovery-suggest ──────────────────────────
  // Agent-stub recovery suggestions for a stale lead. Sprint 1 ships a
  // rule-based heuristic; Sprint 2 swaps in a Dust agent call.
  server.post(
    '/leads/:id/recovery-suggest',
    {
      schema: {
        params: IdParam,
        response: { 200: RecoverySuggestResponse },
      },
    },
    async (req) => {
      const lead = await prisma.lead.findFirst({
        where: { id: req.params.id, orgId: req.auth.orgId, deletedAt: null },
      });
      if (!lead) throw server.httpErrors.notFound('Lead not found');

      const cfg = await prisma.leadStageRotConfig.findUnique({
        where: { orgId_status: { orgId: req.auth.orgId, status: lead.status } },
      });
      const rottenDays = cfg?.rottenDays ?? LEAD_ROT_DEFAULTS[lead.status];
      const daysInStage = daysBetween(lead.statusChangedAt, new Date());
      const isRotten = rottenDays !== null && daysInStage >= rottenDays;

      const plays: RecoveryPlay[] = buildPlays(lead.status, daysInStage, isRotten);

      return {
        leadId: lead.id,
        daysInStage,
        rottenDays: rottenDays ?? null,
        isRotten,
        plays,
      };
    },
  );
};

function daysBetween(then: Date, now: Date): number {
  const ms = now.getTime() - then.getTime();
  return Math.max(0, Math.floor(ms / (1000 * 60 * 60 * 24)));
}

function buildPlays(
  status: z.infer<typeof LeadStatus>,
  daysInStage: number,
  isRotten: boolean,
): RecoveryPlay[] {
  if (!isRotten) {
    return [];
  }
  const plays: RecoveryPlay[] = [];

  if (status === 'new' || status === 'contacted') {
    plays.push({
      kind: 'send_reengagement_email',
      rationale: `${daysInStage} days without progress — a short re-engagement note keeps the lead warm.`,
      payload: {},
      confidence: 0.75,
    });
  }

  if (status === 'contacted' || status === 'qualified') {
    plays.push({
      kind: 'schedule_call',
      rationale: 'Live conversation tends to outperform another email at this stage.',
      payload: {},
      confidence: 0.6,
    });
  }

  if (status === 'nurture' || status === 'qualified') {
    plays.push({
      kind: 'add_to_nurture',
      rationale: 'Drop into a long-cycle nurture cadence and revisit in two weeks.',
      payload: {},
      confidence: 0.55,
    });
  }

  plays.push({
    kind: 'mark_lost',
    rationale: 'If outreach has gone silent for this long, marking lost frees pipeline focus.',
    payload: {},
    confidence: 0.4,
  });

  return plays.slice(0, 4);
}
