// Integration tests for the analytics report builder routes.
// Pattern: tasks.integration.test.ts - buildServer + inject against a
// throwaway isolated stub org; every fixture is cleaned up in afterAll.
import { afterAll, beforeAll, describe, expect } from 'vitest';

import { prisma } from '@bidstack/db';

import { buildServer } from '../server.js';
import {
  createIsolatedOrg,
  dropIsolatedOrg,
  useIsolatedOrgAuth,
} from '../test-support/isolated-org.js';
import { makeSkipIfNoDb } from '../test-support/skip-if-no-db.js';

let server: Awaited<ReturnType<typeof buildServer>>;
let dbReachable = false;
let orgId: string | null = null;
let restoreAuth: (() => void) | null = null;
const createdReportIds: string[] = [];

const TASK_COUNT_QUERY = {
  entity: 'task',
  aggregates: [{ fn: 'COUNT', field: '*' }],
  groupBy: [{ field: 'status' }],
};

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    dbReachable = false;
    return;
  }
  const org = await createIsolatedOrg('analytics-reports');
  orgId = org.orgId;
  restoreAuth = useIsolatedOrgAuth(org.clerkOrg);

  server = await buildServer();
  await server.ready();
});

afterAll(async () => {
  for (const id of createdReportIds) {
    await prisma.auditLog.deleteMany({ where: { targetType: 'analytics_report', targetId: id } });
    await prisma.analyticsReportRun.deleteMany({ where: { reportId: id } });
    await prisma.analyticsReport.deleteMany({ where: { id } });
  }
  if (server) await server.close();
  if (restoreAuth) restoreAuth();
  if (orgId) await dropIsolatedOrg(orgId);
  if (dbReachable) await prisma.$disconnect();
});

const skipIfNoDb = makeSkipIfNoDb(() => dbReachable && !!orgId);

describe('analytics reports routes', () => {
  skipIfNoDb('POST /api/reports creates a report and writes an audit row', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/reports',
      payload: { name: 'Tasks by status', query: TASK_COUNT_QUERY, chartType: 'bar' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { id: string; orgId: string; name: string; chartType: string };
    expect(body.name).toBe('Tasks by status');
    expect(body.chartType).toBe('bar');
    expect(body.orgId).toBe(orgId);
    createdReportIds.push(body.id);

    const audit = await prisma.auditLog.findFirst({
      where: { orgId: orgId!, action: 'analytics_report.create', targetId: body.id },
    });
    expect(audit).not.toBeNull();
  });

  skipIfNoDb('POST /api/reports rejects queries with non-allowlisted fields', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/reports',
      payload: {
        name: 'Evil',
        query: { entity: 'task', aggregates: [{ fn: 'SUM', field: 'org_id' }] },
      },
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { message: string }).message).toMatch(/Unknown aggregate field/);
  });

  skipIfNoDb('GET /api/reports lists the created report (bare array)', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/reports' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Array<{ id: string }>;
    expect(Array.isArray(body)).toBe(true);
    expect(body.some((r) => r.id === createdReportIds[0])).toBe(true);
  });

  skipIfNoDb('GET /api/reports/:id returns the report; foreign uuid 404s', async () => {
    const ok = await server.inject({ method: 'GET', url: `/api/reports/${createdReportIds[0]}` });
    expect(ok.statusCode).toBe(200);

    const missing = await server.inject({
      method: 'GET',
      url: '/api/reports/11111111-2222-3333-4444-555555555555',
    });
    expect(missing.statusCode).toBe(404);
  });

  skipIfNoDb('GET /api/reports/pipeline still hits the legacy route (uuid guard)', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/reports/pipeline' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { byStage?: unknown };
    // Legacy pipeline KPIs shape, not an analytics report
    expect(body.byStage).toBeDefined();
  });

  skipIfNoDb('PATCH /api/reports/:id updates name', async () => {
    const res = await server.inject({
      method: 'PATCH',
      url: `/api/reports/${createdReportIds[0]}`,
      payload: { name: 'Tasks by status v2' },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { name: string }).name).toBe('Tasks by status v2');
  });

  skipIfNoDb('POST /api/reports/:id/duplicate copies the report', async () => {
    const res = await server.inject({
      method: 'POST',
      url: `/api/reports/${createdReportIds[0]}/duplicate`,
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { id: string; name: string };
    expect(body.name).toContain('(copy)');
    createdReportIds.push(body.id);
  });

  skipIfNoDb('POST /api/reports/:id/run executes the full lifecycle', async () => {
    const res = await server.inject({
      method: 'POST',
      url: `/api/reports/${createdReportIds[0]}/run`,
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    const run = res.json() as {
      id: string;
      reportId: string;
      status: string;
      rowCount: number;
      result: Array<Record<string, unknown>>;
      startedAt: string;
      finishedAt: string;
    };
    expect(run.reportId).toBe(createdReportIds[0]);
    expect(run.status).toBe('done');
    expect(typeof run.rowCount).toBe('number');
    expect(Array.isArray(run.result)).toBe(true);
    // Grouped count: every row carries the group key + the count value
    for (const row of run.result) {
      expect(row).toHaveProperty('status');
      expect(row).toHaveProperty('value');
    }
    expect(run.startedAt).toBeDefined();
    expect(run.finishedAt).toBeDefined();

    // lastRunAt bumped on the report
    const report = await prisma.analyticsReport.findFirstOrThrow({
      where: { id: createdReportIds[0], orgId: orgId! },
    });
    expect(report.lastRunAt).not.toBeNull();
  });

  skipIfNoDb('GET /api/reports/:id/runs + /runs/:runId return persisted runs', async () => {
    const list = await server.inject({
      method: 'GET',
      url: `/api/reports/${createdReportIds[0]}/runs`,
    });
    expect(list.statusCode).toBe(200);
    const runs = list.json() as Array<{ id: string; status: string }>;
    expect(runs.length).toBeGreaterThanOrEqual(1);

    const single = await server.inject({
      method: 'GET',
      url: `/api/reports/${createdReportIds[0]}/runs/${runs[0]!.id}`,
    });
    expect(single.statusCode).toBe(200);
    expect((single.json() as { id: string }).id).toBe(runs[0]!.id);
  });

  skipIfNoDb('POST /api/reports/run previews without persisting (KPI value shape)', async () => {
    const before = await prisma.analyticsReportRun.count({ where: { orgId: orgId! } });
    const res = await server.inject({
      method: 'POST',
      url: '/api/reports/run',
      payload: { query: { entity: 'task', aggregates: [{ fn: 'COUNT', field: '*' }] } },
    });
    expect(res.statusCode).toBe(200);
    const run = res.json() as {
      reportId: string;
      status: string;
      result: Array<Record<string, unknown>>;
    };
    expect(run.reportId).toBe('');
    expect(run.status).toBe('done');
    // Single aggregate, no groupBy -> rows[0].value (KPI widget contract)
    expect(typeof run.result[0]!.value).toBe('number');

    const after = await prisma.analyticsReportRun.count({ where: { orgId: orgId! } });
    expect(after).toBe(before);
  });

  skipIfNoDb('POST /api/reports/run rejects invalid queries with 400 {message}', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/reports/run',
      payload: { query: { entity: 'task', sort: [{ field: 'nope', dir: 'asc' }] } },
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { message: string }).message).toMatch(/Unknown sort field/);
  });

  skipIfNoDb('GET /api/entities/:type/fields serves the authoritative field map', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/entities/task/fields' });
    expect(res.statusCode).toBe(200);
    const fields = res.json() as Array<{ key: string; type: string; enumValues?: string[] }>;
    const status = fields.find((f) => f.key === 'status');
    expect(status?.type).toBe('enum');
    expect(status?.enumValues).toEqual(['open', 'in_progress', 'done', 'blocked']);

    const unknown = await server.inject({ method: 'GET', url: '/api/entities/pets/fields' });
    expect(unknown.statusCode).toBe(404);
  });

  skipIfNoDb("cross-org: another org's report ids 404 on read, patch, run and delete", async () => {
    // Foreign-org fixture created directly in the DB; requests run as the
    // isolated stub org, so every route must answer 404 - proving
    // tenant scoping on the ROUTE layer, not just in compiled SQL.
    const foreignOrg = await prisma.org.create({
      data: { name: 'Analytics XOrg Test', clerkOrg: `org_xorg_${Date.now()}` },
    });
    const foreignUser = await prisma.user.create({
      data: {
        orgId: foreignOrg.id,
        clerkUser: `user_xorg_${Date.now()}`,
        email: `xorg-${Date.now()}@test.local`,
        name: 'X Org',
      },
    });
    const foreignReport = await prisma.analyticsReport.create({
      data: {
        orgId: foreignOrg.id,
        ownerId: foreignUser.id,
        name: 'Foreign report',
        query: TASK_COUNT_QUERY,
      },
    });
    try {
      const read = await server.inject({ method: 'GET', url: `/api/reports/${foreignReport.id}` });
      expect(read.statusCode).toBe(404);
      const patch = await server.inject({
        method: 'PATCH',
        url: `/api/reports/${foreignReport.id}`,
        payload: { name: 'hijack' },
      });
      expect(patch.statusCode).toBe(404);
      const run = await server.inject({
        method: 'POST',
        url: `/api/reports/${foreignReport.id}/run`,
        payload: {},
      });
      expect(run.statusCode).toBe(404);
      const del = await server.inject({
        method: 'DELETE',
        url: `/api/reports/${foreignReport.id}`,
      });
      expect(del.statusCode).toBe(404);
    } finally {
      await prisma.analyticsReport.deleteMany({ where: { orgId: foreignOrg.id } });
      await prisma.user.deleteMany({ where: { orgId: foreignOrg.id } });
      await prisma.org.delete({ where: { id: foreignOrg.id } });
    }
  });

  skipIfNoDb('DELETE /api/reports/:id soft-deletes and hides the report', async () => {
    const create = await server.inject({
      method: 'POST',
      url: '/api/reports',
      payload: { name: 'Delete me', query: TASK_COUNT_QUERY },
    });
    expect(create.statusCode).toBe(201);
    const id = (create.json() as { id: string }).id;
    createdReportIds.push(id);

    const del = await server.inject({ method: 'DELETE', url: `/api/reports/${id}` });
    expect(del.statusCode).toBe(204);

    const get = await server.inject({ method: 'GET', url: `/api/reports/${id}` });
    expect(get.statusCode).toBe(404);
  });
});
