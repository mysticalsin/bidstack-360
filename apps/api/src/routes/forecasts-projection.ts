// Pipeline-weighted forecast projection (authenticated, org-scoped).
//
// Endpoint:
//   GET /forecasts/projection — derived weighted-pipeline forecast for the
//   current quarter + next 2, bucketed by close-date period and owner.
//
// Manual /forecasts rows are surfaced as per-period commit overrides; the
// derived baseline never goes blank while open pipeline exists.

import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { prisma, Prisma } from '@bidstack/db';
import { ForecastProjection } from '@bidstack/shared';

import {
  aggregateProjection,
  buildProjectionWindow,
  type ProjectionRow,
} from './forecasts-projection.helpers.js';

const FORWARD_QUARTERS = 2; // current quarter + next 2 = 3-period rolling window
const FORECAST_CURRENCY = 'EUR'; // micros are EUR at rest (CLAUDE.md money convention)
const isoDate = (d: Date): string => d.toISOString().slice(0, 10);

export const forecastsProjectionRoutes: FastifyPluginAsyncZod = async (server) => {
  // GET /api/forecasts/projection
  server.get(
    '/forecasts/projection',
    { schema: { response: { 200: ForecastProjection } } },
    async (req) => {
      const orgId = req.auth.orgId;
      const window = buildProjectionWindow(new Date(), FORWARD_QUARTERS);
      const curStart = isoDate(window.curQuarterStart);
      const winEnd = isoDate(window.windowEndExclusive);

      // Aggregate in Postgres so the payload is bounded to periods × owners ×
      // stages. Open pipeline with a null/overdue close date rolls into the
      // current quarter (it is live now); won is date-anchored actuals only.
      const rows = await prisma.$queryRaw<ProjectionRow[]>(Prisma.sql`
        SELECT
          CASE
            WHEN o.stage = 'closed_won' THEN
              CASE
                WHEN o.due_date >= ${curStart}::date AND o.due_date < ${winEnd}::date
                  THEN to_char(o.due_date, 'YYYY"-Q"Q')
                ELSE NULL
              END
            ELSE
              CASE
                WHEN o.due_date IS NULL OR o.due_date < ${curStart}::date
                  THEN ${window.currentPeriod}
                WHEN o.due_date < ${winEnd}::date
                  THEN to_char(o.due_date, 'YYYY"-Q"Q')
                ELSE NULL
              END
          END AS period,
          o.owner_id AS "ownerId",
          COALESCE(u.name, 'Unassigned') AS "ownerName",
          o.stage::text AS stage,
          COALESCE(SUM(o.value_micros), 0)::text AS "valueMicros"
        FROM opportunities o
        LEFT JOIN users u ON u.id = o.owner_id
        WHERE o.org_id = ${orgId}::uuid
          AND o.deleted_at IS NULL
          AND o.stage <> 'closed_lost'
        GROUP BY 1, o.owner_id, u.name, o.stage
      `);

      const [stageProbabilities, manualCommitByPeriod] = await Promise.all([
        loadStageProbabilities(orgId),
        loadManualCommit(orgId, window.periods),
      ]);

      const periods = aggregateProjection(rows, window, stageProbabilities, manualCommitByPeriod);
      return { currency: FORECAST_CURRENCY, generatedAt: new Date().toISOString(), periods };
    },
  );
};

/** Org's configurable stage win-probabilities, keyed by stage key (first wins). */
async function loadStageProbabilities(orgId: string): Promise<Map<string, number>> {
  const stages = await prisma.pipelineStage.findMany({
    where: { orgId, deletedAt: null },
    select: { key: true, probability: true },
    orderBy: { orderIndex: 'asc' },
    take: 200,
  });
  const map = new Map<string, number>();
  for (const s of stages) if (!map.has(s.key)) map.set(s.key, Number(s.probability));
  return map;
}

/** Sum of manual commit forecasts per in-window period (the override headline). */
async function loadManualCommit(orgId: string, periods: string[]): Promise<Map<string, number>> {
  const rows = await prisma.forecast.findMany({
    where: { orgId, deletedAt: null, category: 'commit', period: { in: periods } },
    select: { period: true, amountMicros: true },
    take: 500,
  });
  const map = new Map<string, number>();
  for (const r of rows) map.set(r.period, (map.get(r.period) ?? 0) + Number(r.amountMicros));
  return map;
}
