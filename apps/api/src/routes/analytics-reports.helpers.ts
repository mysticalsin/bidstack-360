// Serialization + execution helpers for the analytics report routes.
// Wire format: ISO-8601 strings for dates, nulls collapsed to undefined so the
// Zod response serializer drops the keys (frontend types use optional fields).
import type { FastifyBaseLogger } from 'fastify';

import { prisma } from '@bidstack/db';
import type {
  AnalyticsChartType,
  AnalyticsQuery,
  AnalyticsReport,
  AnalyticsReportRun,
  AnalyticsReportRunStatus,
} from '@bidstack/shared';

import {
  AnalyticsQueryError,
  compileAnalyticsQuery,
  normalizeAnalyticsRows,
} from '../lib/analytics-engine.js';

/** Runs kept per report — older ones are pruned in the run transaction. */
const RUN_RETENTION = 20;
/** Persisted result budget; larger payloads stay live-only. */
const MAX_PERSISTED_RESULT_BYTES = 1_000_000;

// Structural row types — the generated Prisma model types for the analytics
// tables are not re-exported from @bidstack/db; the delegates satisfy these.
export interface DbAnalyticsReport {
  id: string;
  orgId: string;
  name: string;
  description: string | null;
  ownerId: string;
  query: unknown;
  chartType: string;
  schedule: string | null;
  lastRunAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface DbAnalyticsReportRun {
  id: string;
  reportId: string;
  status: string;
  startedAt: Date | null;
  finishedAt: Date | null;
  rowCount: number | null;
  result: unknown;
  error: string | null;
  createdAt: Date;
}

export function serializeReport(r: DbAnalyticsReport): AnalyticsReport {
  return {
    id: r.id,
    orgId: r.orgId,
    name: r.name,
    description: r.description ?? undefined,
    ownerId: r.ownerId,
    // Stored queries were validated by the AnalyticsQuery schema on write.
    query: r.query as AnalyticsQuery,
    chartType: r.chartType as AnalyticsChartType,
    schedule: r.schedule ?? undefined,
    lastRunAt: r.lastRunAt?.toISOString(),
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

export function serializeRun(r: DbAnalyticsReportRun): AnalyticsReportRun {
  return {
    id: r.id,
    reportId: r.reportId,
    status: r.status as AnalyticsReportRunStatus,
    startedAt: r.startedAt?.toISOString(),
    finishedAt: r.finishedAt?.toISOString(),
    rowCount: r.rowCount ?? undefined,
    result: (r.result as Array<Record<string, unknown>> | null) ?? undefined,
    error: r.error ?? undefined,
    createdAt: r.createdAt.toISOString(),
  };
}

/**
 * Compile + execute a query, returning JSON-safe rows. Runs inside an
 * interactive transaction so SET LOCAL statement_timeout cancels runaway
 * user-shaped queries without touching the connection's default.
 */
export async function executeAnalyticsQuery(
  orgId: string,
  query: AnalyticsQuery,
): Promise<Array<Record<string, unknown>>> {
  const sql = compileAnalyticsQuery(orgId, query);
  const rows = await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '10s'");
    return tx.$queryRaw<Array<Record<string, unknown>>>(sql);
  });
  return normalizeAnalyticsRows(rows);
}

/** Client-safe error text: engine messages pass, driver internals do not. */
function sanitizeRunError(err: unknown, log: FastifyBaseLogger): string {
  if (err instanceof AnalyticsQueryError) return err.message;
  log.error({ err }, 'analytics report run failed');
  return 'Query execution failed';
}

/**
 * Synchronous run lifecycle. The query executes FIRST and the run row is
 * created once with its final status (done|error) — a crash mid-execution
 * leaves no zombie `running` row. The same transaction bumps lastRunAt and
 * prunes runs beyond RUN_RETENTION.
 */
export async function runPersistedReport(args: {
  orgId: string;
  reportId: string;
  query: AnalyticsQuery;
  log: FastifyBaseLogger;
}): Promise<DbAnalyticsReportRun> {
  const startedAt = new Date();
  let rows: Array<Record<string, unknown>> | null = null;
  let error: string | null = null;
  try {
    rows = await executeAnalyticsQuery(args.orgId, args.query);
  } catch (err) {
    error = sanitizeRunError(err, args.log);
  }
  const finishedAt = new Date();

  // Oversized results stay live-only: the run records rowCount but not the
  // payload, so the table cannot be grown multiple MB per request.
  let result: object[] | null = rows as object[] | null;
  if (rows && JSON.stringify(rows).length > MAX_PERSISTED_RESULT_BYTES) {
    result = null;
    error = 'Result too large to persist; re-run to view live.';
  }

  return prisma.$transaction(async (tx) => {
    const run = await tx.analyticsReportRun.create({
      data: {
        orgId: args.orgId,
        reportId: args.reportId,
        status: rows ? 'done' : 'error',
        startedAt,
        finishedAt,
        rowCount: rows ? rows.length : null,
        result: result ?? undefined,
        error: error ?? undefined,
      },
    });
    if (rows) {
      await tx.analyticsReport.updateMany({
        where: { id: args.reportId, orgId: args.orgId, deletedAt: null },
        data: { lastRunAt: finishedAt },
      });
    }
    // Retention: keep the newest RUN_RETENTION runs per report.
    const stale = await tx.analyticsReportRun.findMany({
      where: { orgId: args.orgId, reportId: args.reportId },
      orderBy: { createdAt: 'desc' },
      skip: RUN_RETENTION,
      take: 100,
      select: { id: true },
    });
    if (stale.length > 0) {
      await tx.analyticsReportRun.deleteMany({
        where: { id: { in: stale.map((r) => r.id) }, orgId: args.orgId },
      });
    }
    return run;
  });
}
