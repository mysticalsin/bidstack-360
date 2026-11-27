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
import { purgeAuditRows } from '../test-support/purge-audit-rows.js';

let server: Awaited<ReturnType<typeof buildServer>>;
let dbReachable = false;
let orgId: string | null = null;
let restoreAuth: (() => void) | null = null;
const createdReportIds: string[] = [];
const createdDashboardIds: string[] = [];

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
  for (const id of createdDashboardIds) {
    await purgeAuditRows({ where: { targetType: 'analytics_dashboard', targetId: id } });
    await prisma.analyticsDashboardWidget.deleteMany({ where: { dashboardId: id } });
    await prisma.analyticsDashboard.deleteMany({ where: { id } });
  }
  for (const id of createdReportIds) {
    await purgeAuditRows({ where: { targetType: 'analytics_report', targetId: id } });
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

  skipIfNoDb(
    'a reports:write user who cannot edit every referencing dashboard gets 403 on PATCH, DELETE, and run',
    async () => {
      // WHY: PATCH, DELETE, and POST /reports/:id/run rewrite a report, remove
      // it, or persist a run that dashboards surface as latestRunId. Those
      // three routes are gated only on reports:write, so a teammate with that
      // permission can change a report that sits on someone else's widgets.
      // The caller must canEdit (dashboard owner, or a system Admin) every
      // live dashboard whose widgets reference the report. Editing one of
      // those dashboards is not enough. A report with no widget references
      // stays mutable with reports:write alone.
      const previous = process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER;
      process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER = 'true';
      const ownerHeaders = { 'x-bidstack-e2e-role': 'sales-manager' };
      const intruderHeaders = { 'x-bidstack-e2e-role': 'account-executive' };
      const editorOnly = 'Only an editor of every dashboard using this report can change it';
      let grant: { roleId: string; permissionId: string } | null = null;
      try {
        const permission = await prisma.permission.findUniqueOrThrow({
          where: { key: 'reports:write' },
          select: { id: true },
        });
        const aeRole = await prisma.role.findFirstOrThrow({
          where: { orgId: orgId!, name: 'Account Executive', deletedAt: null },
          select: { id: true },
        });
        // The seeded Account Executive can read reports but cannot write them.
        // This grant is the synthetic reports:write the finding is about, on a
        // user who is neither a dashboard owner nor a system Admin.
        await prisma.rolePermission.updateMany({
          where: {
            roleId: aeRole.id,
            permissionId: permission.id,
            deletedAt: { not: null },
          },
          data: { deletedAt: null },
        });
        await prisma.rolePermission.upsert({
          where: {
            roleId_permissionId: { roleId: aeRole.id, permissionId: permission.id },
          },
          create: { roleId: aeRole.id, permissionId: permission.id, orgId: orgId! },
          update: { orgId: orgId!, deletedAt: null },
        });
        grant = { roleId: aeRole.id, permissionId: permission.id };

        const caps = async (headers?: Record<string, string>) => {
          const res = await server.inject({
            method: 'GET',
            url: '/api/me/capabilities',
            ...(headers ? { headers } : {}),
          });
          expect(res.statusCode).toBe(200);
          return res.json() as {
            userId: string;
            permissions: string[];
            isAdmin: boolean;
          };
        };
        const intruder = await caps(intruderHeaders);
        const owner = await caps(ownerHeaders);
        const admin = await caps();
        expect(intruder.permissions).toContain('reports:write');
        expect(owner.permissions).toContain('reports:write');
        expect(admin.permissions).toContain('reports:write');
        expect(intruder.isAdmin).toBe(false);
        expect(owner.isAdmin).toBe(false);
        expect(admin.isAdmin).toBe(true);
        expect(new Set([intruder.userId, owner.userId, admin.userId]).size).toBe(3);

        const loose = await server.inject({
          method: 'POST',
          url: '/api/reports',
          headers: intruderHeaders,
          payload: { name: 'Unreferenced report', query: TASK_COUNT_QUERY, chartType: 'bar' },
        });
        expect(loose.statusCode).toBe(201);
        const looseId = (loose.json() as { id: string }).id;
        createdReportIds.push(looseId);
        const loosePatch = await server.inject({
          method: 'PATCH',
          url: `/api/reports/${looseId}`,
          headers: intruderHeaders,
          payload: { name: 'Unreferenced report renamed' },
        });
        expect(loosePatch.statusCode).toBe(200);
        const looseRun = await server.inject({
          method: 'POST',
          url: `/api/reports/${looseId}/run`,
          headers: intruderHeaders,
          payload: {},
        });
        expect(looseRun.statusCode).toBe(200);
        const looseDelete = await server.inject({
          method: 'DELETE',
          url: `/api/reports/${looseId}`,
          headers: intruderHeaders,
        });
        expect(looseDelete.statusCode).toBe(204);

        const created = await server.inject({
          method: 'POST',
          url: '/api/reports',
          headers: ownerHeaders,
          payload: { name: 'Widget source', query: TASK_COUNT_QUERY, chartType: 'bar' },
        });
        expect(created.statusCode).toBe(201);
        const reportId = (created.json() as { id: string }).id;
        createdReportIds.push(reportId);

        const board = await server.inject({
          method: 'POST',
          url: '/api/dashboards',
          headers: ownerHeaders,
          payload: { name: 'Owner shared board', isShared: true },
        });
        expect(board.statusCode).toBe(201);
        const dashboardId = (board.json() as { id: string }).id;
        createdDashboardIds.push(dashboardId);
        const widget = await server.inject({
          method: 'POST',
          url: `/api/dashboards/${dashboardId}/widgets`,
          headers: ownerHeaders,
          payload: { reportId, title: 'Owner widget', type: 'kpi' },
        });
        expect(widget.statusCode).toBe(201);
        const widgetId = (widget.json() as { id: string }).id;

        const readBoard = async (headers?: Record<string, string>) => {
          const res = await server.inject({
            method: 'GET',
            url: `/api/dashboards/${dashboardId}`,
            ...(headers ? { headers } : {}),
          });
          expect(res.statusCode).toBe(200);
          return res.json() as { ownerId: string; canEdit: boolean };
        };
        const ownerView = await readBoard(ownerHeaders);
        const adminView = await readBoard();
        const intruderView = await readBoard(intruderHeaders);
        expect(ownerView.ownerId).toBe(owner.userId);
        expect(ownerView.canEdit).toBe(true);
        expect(adminView.ownerId).toBe(owner.userId);
        expect(adminView.canEdit).toBe(true);
        expect(intruderView.canEdit).toBe(false);

        const storedName = async () => {
          const row = await prisma.analyticsReport.findFirstOrThrow({
            where: { id: reportId, orgId: orgId! },
            select: { name: true, deletedAt: true },
          });
          return row;
        };
        const runCount = () =>
          prisma.analyticsReportRun.count({ where: { orgId: orgId!, reportId } });

        const deniedPatch = await server.inject({
          method: 'PATCH',
          url: `/api/reports/${reportId}`,
          headers: intruderHeaders,
          payload: { name: 'Taken over' },
        });
        expect(deniedPatch.statusCode).toBe(403);
        expect((deniedPatch.json() as { message: string }).message).toBe(editorOnly);
        expect((await storedName()).name).toBe('Widget source');

        const runsBefore = await runCount();
        const deniedRun = await server.inject({
          method: 'POST',
          url: `/api/reports/${reportId}/run`,
          headers: intruderHeaders,
          payload: {},
        });
        expect(deniedRun.statusCode).toBe(403);
        expect((deniedRun.json() as { message: string }).message).toBe(editorOnly);
        expect(await runCount()).toBe(runsBefore);

        const deniedDelete = await server.inject({
          method: 'DELETE',
          url: `/api/reports/${reportId}`,
          headers: intruderHeaders,
        });
        expect(deniedDelete.statusCode).toBe(403);
        expect((deniedDelete.json() as { message: string }).message).toBe(editorOnly);
        expect((await storedName()).deletedAt).toBeNull();
        const stillLinked = await prisma.analyticsDashboardWidget.findFirstOrThrow({
          where: { id: widgetId, orgId: orgId! },
          select: { reportId: true },
        });
        expect(stillLinked.reportId).toBe(reportId);

        const ownerPatch = await server.inject({
          method: 'PATCH',
          url: `/api/reports/${reportId}`,
          headers: ownerHeaders,
          payload: { name: 'Owner renamed' },
        });
        expect(ownerPatch.statusCode).toBe(200);
        expect((ownerPatch.json() as { name: string }).name).toBe('Owner renamed');
        const ownerRun = await server.inject({
          method: 'POST',
          url: `/api/reports/${reportId}/run`,
          headers: ownerHeaders,
          payload: {},
        });
        expect(ownerRun.statusCode).toBe(200);
        expect((ownerRun.json() as { status: string }).status).toBe('done');

        const adminPatch = await server.inject({
          method: 'PATCH',
          url: `/api/reports/${reportId}`,
          payload: { name: 'Admin renamed' },
        });
        expect(adminPatch.statusCode).toBe(200);
        expect((adminPatch.json() as { name: string }).name).toBe('Admin renamed');
        const adminRun = await server.inject({
          method: 'POST',
          url: `/api/reports/${reportId}/run`,
          payload: {},
        });
        expect(adminRun.statusCode).toBe(200);
        expect((adminRun.json() as { status: string }).status).toBe('done');

        const ownerOnly = await server.inject({
          method: 'POST',
          url: '/api/reports',
          headers: ownerHeaders,
          payload: { name: 'Owner-only source', query: TASK_COUNT_QUERY, chartType: 'bar' },
        });
        expect(ownerOnly.statusCode).toBe(201);
        const ownerOnlyId = (ownerOnly.json() as { id: string }).id;
        createdReportIds.push(ownerOnlyId);
        const ownerOnlyWidget = await server.inject({
          method: 'POST',
          url: `/api/dashboards/${dashboardId}/widgets`,
          headers: ownerHeaders,
          payload: { reportId: ownerOnlyId, title: 'Owner-only widget', type: 'kpi' },
        });
        expect(ownerOnlyWidget.statusCode).toBe(201);
        const intruderDeletesOwnerOnly = await server.inject({
          method: 'DELETE',
          url: `/api/reports/${ownerOnlyId}`,
          headers: intruderHeaders,
        });
        expect(intruderDeletesOwnerOnly.statusCode).toBe(403);
        expect((intruderDeletesOwnerOnly.json() as { message: string }).message).toBe(editorOnly);
        const ownerDeletes = await server.inject({
          method: 'DELETE',
          url: `/api/reports/${ownerOnlyId}`,
          headers: ownerHeaders,
        });
        expect(ownerDeletes.statusCode).toBe(204);

        // A second live dashboard, owned by the intruder, also shows the
        // report. Each of those two users canEdit exactly one board, so
        // neither may change the report. The admin canEdit both.
        const second = await server.inject({
          method: 'POST',
          url: '/api/dashboards',
          headers: intruderHeaders,
          payload: { name: 'Intruder shared board', isShared: true },
        });
        expect(second.statusCode).toBe(201);
        const secondId = (second.json() as { id: string }).id;
        createdDashboardIds.push(secondId);
        const secondWidget = await server.inject({
          method: 'POST',
          url: `/api/dashboards/${secondId}/widgets`,
          headers: intruderHeaders,
          payload: { reportId, title: 'Intruder widget', type: 'kpi' },
        });
        expect(secondWidget.statusCode).toBe(201);
        const ownerOnSecond = await server.inject({
          method: 'GET',
          url: `/api/dashboards/${secondId}`,
          headers: ownerHeaders,
        });
        const intruderOnSecond = await server.inject({
          method: 'GET',
          url: `/api/dashboards/${secondId}`,
          headers: intruderHeaders,
        });
        expect(ownerOnSecond.statusCode).toBe(200);
        expect(intruderOnSecond.statusCode).toBe(200);
        expect((ownerOnSecond.json() as { canEdit: boolean }).canEdit).toBe(false);
        expect((intruderOnSecond.json() as { canEdit: boolean }).canEdit).toBe(true);

        const runsBeforeSplit = await runCount();
        for (const headers of [ownerHeaders, intruderHeaders]) {
          const patch = await server.inject({
            method: 'PATCH',
            url: `/api/reports/${reportId}`,
            headers,
            payload: { name: 'Split takeover' },
          });
          expect(patch.statusCode).toBe(403);
          expect((patch.json() as { message: string }).message).toBe(editorOnly);
          const run = await server.inject({
            method: 'POST',
            url: `/api/reports/${reportId}/run`,
            headers,
            payload: {},
          });
          expect(run.statusCode).toBe(403);
          expect((run.json() as { message: string }).message).toBe(editorOnly);
          const del = await server.inject({
            method: 'DELETE',
            url: `/api/reports/${reportId}`,
            headers,
          });
          expect(del.statusCode).toBe(403);
          expect((del.json() as { message: string }).message).toBe(editorOnly);
        }
        expect((await storedName()).name).toBe('Admin renamed');
        expect((await storedName()).deletedAt).toBeNull();
        expect(await runCount()).toBe(runsBeforeSplit);

        const adminAfterSplit = await server.inject({
          method: 'PATCH',
          url: `/api/reports/${reportId}`,
          payload: { name: 'Admin kept both boards' },
        });
        expect(adminAfterSplit.statusCode).toBe(200);
        const adminRunAfterSplit = await server.inject({
          method: 'POST',
          url: `/api/reports/${reportId}/run`,
          payload: {},
        });
        expect(adminRunAfterSplit.statusCode).toBe(200);
        expect((adminRunAfterSplit.json() as { status: string }).status).toBe('done');
        const adminDelete = await server.inject({
          method: 'DELETE',
          url: `/api/reports/${reportId}`,
        });
        expect(adminDelete.statusCode).toBe(204);
        const gone = await server.inject({ method: 'GET', url: `/api/reports/${reportId}` });
        expect(gone.statusCode).toBe(404);
      } finally {
        if (grant) {
          await prisma.rolePermission.deleteMany({
            where: { roleId: grant.roleId, permissionId: grant.permissionId },
          });
        }
        if (previous === undefined) delete process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER;
        else process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER = previous;
      }
    },
  );

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
