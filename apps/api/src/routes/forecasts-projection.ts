// Pipeline-weighted forecast projection (authenticated, org-scoped).
//
// Endpoint:
//   GET /forecasts/projection — derived weighted-pipeline forecast for the
//   current quarter + next 2, bucketed by close-date period and owner.
//
// Manual /forecasts rows are surfaced as per-period commit overrides; the
// derived baseline never goes blank while open pipeline exists.

import type { FastifyBaseLogger } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { prisma, Prisma } from '@bidstack/db';
import { ForecastProjection } from '@bidstack/shared';

import {
  aggregateManualCommit,
  aggregateProjection,
  buildProjectionWindow,
  type ProjectionRow,
} from './forecasts-projection.helpers.js';

const FORWARD_QUARTERS = 2; // current quarter + next 2 = 3-period rolling window
// Opportunities do not store a currency. XXX is the ISO code for no currency.
// Older forecast rows were written as EUR by the form default; they are the same bucket.
const FORECAST_CURRENCY = 'XXX';
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
            WHEN (
              o.stage = 'closed_won'
              OR EXISTS (
                SELECT 1 FROM pipeline_stages ps
                WHERE ps.id = o.pipeline_stage_id
                  AND ps.deleted_at IS NULL
                  AND ps.is_won
                  AND NOT ps.is_lost
              )
            ) THEN
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
          CASE
            WHEN (
              o.stage = 'closed_won'
              OR EXISTS (
                SELECT 1 FROM pipeline_stages ps
                WHERE ps.id = o.pipeline_stage_id
                  AND ps.deleted_at IS NULL
                  AND ps.is_won
                  AND NOT ps.is_lost
              )
            ) THEN 'closed_won'
            ELSE o.stage::text
          END AS stage,
          CASE
            WHEN live.id IS NULL THEN NULL
            ELSE live.probability::float8
          END AS "stageProbability",
          COALESCE(SUM(o.value_micros), 0)::text AS "valueMicros"
        FROM opportunities o
        LEFT JOIN users u ON u.id = o.owner_id AND u.org_id = o.org_id
        LEFT JOIN pipeline_stages live
          ON live.id = o.pipeline_stage_id
         AND live.deleted_at IS NULL
        WHERE o.org_id = ${orgId}::uuid
          AND o.deleted_at IS NULL
          AND o.stage <> 'closed_lost'
          AND NOT EXISTS (
            SELECT 1 FROM pipeline_stages ps
            WHERE ps.id = o.pipeline_stage_id
              AND ps.deleted_at IS NULL
              AND ps.is_lost
          )
        GROUP BY 1, o.owner_id, u.name, 4, 5
      `);

      const [stageProbabilities, manualCommitByPeriod] = await Promise.all([
        loadStageProbabilities(orgId),
        loadManualCommit(orgId, window.periods, FORECAST_CURRENCY, req.log),
      ]);

      const periods = aggregateProjection(rows, window, stageProbabilities, manualCommitByPeriod);
      return { currency: FORECAST_CURRENCY, generatedAt: new Date().toISOString(), periods };
    },
  );
};

/** Fallback win-probabilities for deals with no live stage, keyed by stage key (first wins). */
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

/**
 * Sum of manual commit forecasts per in-window period (the override headline),
 * restricted to the endpoint's reporting currency. Rows in another currency
 * are excluded (not converted/blended) and logged so the exclusion isn't silent.
 */
async function loadManualCommit(
  orgId: string,
  periods: string[],
  currency: string,
  logger: FastifyBaseLogger,
): Promise<Map<string, number>> {
  const rows = await prisma.forecast.findMany({
    where: { orgId, deletedAt: null, category: 'commit', period: { in: periods } },
    select: { period: true, amountMicros: true, currency: true },
    take: 500,
  });
  const { byPeriod, excludedCount } = aggregateManualCommit(rows, currency);
  if (excludedCount > 0) {
    logger.warn(
      { orgId, excludedCount, currency },
      'forecasts-projection: excluded manual commit forecast rows in a non-reporting currency',
    );
  }
  return byPeriod;
}
