// Integration tests for analytics dashboards + widgets.
// Pattern: tasks.integration.test.ts - buildServer + inject against a
// throwaway isolated stub org; fixtures cleaned up in afterAll.
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
const createdDashboardIds: string[] = [];
const createdReportIds: string[] = [];
const createdWidgetIds: string[] = [];

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    dbReachable = false;
    return;
  }
  const org = await createIsolatedOrg('analytics-dashboards');
  orgId = org.orgId;
  restoreAuth = useIsolatedOrgAuth(org.clerkOrg);

  server = await buildServer();
  await server.ready();
});

afterAll(async () => {
  for (const id of createdWidgetIds) {
    await purgeAuditRows({ where: { targetType: 'analytics_widget', targetId: id } });
    await prisma.analyticsDashboardWidget.deleteMany({ where: { id } });
  }
  for (const id of createdDashboardIds) {
    await purgeAuditRows({
      where: { targetType: 'analytics_dashboard', targetId: id },
    });
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

describe('analytics dashboards routes', () => {
  skipIfNoDb('POST /api/dashboards creates a dashboard', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/dashboards',
      payload: { name: 'Pipeline cockpit', description: 'Test board', isShared: true },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { id: string; name: string; isShared: boolean; widgets?: unknown[] };
    expect(body.name).toBe('Pipeline cockpit');
    expect(body.isShared).toBe(true);
    createdDashboardIds.push(body.id);
  });

  skipIfNoDb('GET /api/dashboards lists it; GET /api/dashboards/:id includes widgets', async () => {
    const list = await server.inject({ method: 'GET', url: '/api/dashboards' });
    expect(list.statusCode).toBe(200);
    const items = list.json() as Array<{ id: string }>;
    expect(items.some((d) => d.id === createdDashboardIds[0])).toBe(true);

    const detail = await server.inject({
      method: 'GET',
      url: `/api/dashboards/${createdDashboardIds[0]}`,
    });
    expect(detail.statusCode).toBe(200);
    expect(Array.isArray((detail.json() as { widgets: unknown[] }).widgets)).toBe(true);

    const foreign = await server.inject({
      method: 'GET',
      url: '/api/dashboards/11111111-2222-3333-4444-555555555555',
    });
    expect(foreign.statusCode).toBe(404);
  });

  skipIfNoDb('PATCH /api/dashboards/:id updates fields', async () => {
    const res = await server.inject({
      method: 'PATCH',
      url: `/api/dashboards/${createdDashboardIds[0]}`,
      payload: { name: 'Pipeline cockpit v2' },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { name: string }).name).toBe('Pipeline cockpit v2');
  });

  skipIfNoDb('widget CRUD + computed config.latestRunId merge', async () => {
    // Backing report + one persisted run
    const reportRes = await server.inject({
      method: 'POST',
      url: '/api/reports',
      payload: {
        name: 'Widget backing report',
        query: { entity: 'task', aggregates: [{ fn: 'COUNT', field: '*' }] },
        chartType: 'gauge',
      },
    });
    expect(reportRes.statusCode).toBe(201);
    const reportId = (reportRes.json() as { id: string }).id;
    createdReportIds.push(reportId);

    const runRes = await server.inject({
      method: 'POST',
      url: `/api/reports/${reportId}/run`,
      payload: {},
    });
    expect(runRes.statusCode).toBe(200);
    const runId = (runRes.json() as { id: string }).id;

    // Create widget bound to the report
    const createRes = await server.inject({
      method: 'POST',
      url: `/api/dashboards/${createdDashboardIds[0]}/widgets`,
      payload: { reportId, title: 'Open tasks', type: 'kpi', position: { x: 0, y: 0, w: 2, h: 2 } },
    });
    expect(createRes.statusCode).toBe(201);
    const widget = createRes.json() as { id: string; config: Record<string, unknown> };
    createdWidgetIds.push(widget.id);
    expect(widget.config.latestRunId).toBe(runId);

    // latestRunId is computed, never stored
    const stored = await prisma.analyticsDashboardWidget.findFirstOrThrow({
      where: { id: widget.id, orgId: orgId! },
    });
    expect((stored.config as Record<string, unknown>).latestRunId).toBeUndefined();

    // List merges it too
    const listRes = await server.inject({
      method: 'GET',
      url: `/api/dashboards/${createdDashboardIds[0]}/widgets`,
    });
    expect(listRes.statusCode).toBe(200);
    const widgets = listRes.json() as Array<{ id: string; config: Record<string, unknown> }>;
    const mine = widgets.find((w) => w.id === widget.id);
    expect(mine?.config.latestRunId).toBe(runId);

    // PATCH title + position
    const patchRes = await server.inject({
      method: 'PATCH',
      url: `/api/dashboards/${createdDashboardIds[0]}/widgets/${widget.id}`,
      payload: { title: 'Open tasks v2', position: { x: 1, y: 1, w: 3, h: 2 } },
    });
    expect(patchRes.statusCode).toBe(200);
    const patched = patchRes.json() as { title: string; position: { x: number } };
    expect(patched.title).toBe('Open tasks v2');
    expect(patched.position.x).toBe(1);

    // Cross-tenant reportId rejected
    const badRes = await server.inject({
      method: 'POST',
      url: `/api/dashboards/${createdDashboardIds[0]}/widgets`,
      payload: {
        reportId: '11111111-2222-3333-4444-555555555555',
        title: 'Evil widget',
        type: 'kpi',
      },
    });
    expect(badRes.statusCode).toBe(400);

    // DELETE widget
    const delRes = await server.inject({
      method: 'DELETE',
      url: `/api/dashboards/${createdDashboardIds[0]}/widgets/${widget.id}`,
    });
    expect(delRes.statusCode).toBe(204);
    const gone = await server.inject({
      method: 'GET',
      url: `/api/dashboards/${createdDashboardIds[0]}/widgets`,
    });
    expect((gone.json() as Array<{ id: string }>).some((w) => w.id === widget.id)).toBe(false);
  });

  skipIfNoDb('DELETE /api/dashboards/:id soft-deletes and audit rows exist', async () => {
    const res = await server.inject({
      method: 'DELETE',
      url: `/api/dashboards/${createdDashboardIds[0]}`,
    });
    expect(res.statusCode).toBe(204);

    const get = await server.inject({
      method: 'GET',
      url: `/api/dashboards/${createdDashboardIds[0]}`,
    });
    expect(get.statusCode).toBe(404);

    const audit = await prisma.auditLog.findFirst({
      where: {
        orgId: orgId!,
        action: 'analytics_dashboard.delete',
        targetId: createdDashboardIds[0],
      },
    });
    expect(audit).not.toBeNull();
  });

  skipIfNoDb(
    'a non-owner sales manager is forbidden from adding a widget to a shared dashboard',
    async () => {
      const previous = process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER;
      process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER = 'true';
      try {
        const created = await server.inject({
          method: 'POST',
          url: '/api/dashboards',
          payload: { name: 'Owner shared board', isShared: true },
        });
        expect(created.statusCode).toBe(201);
        const dashboardId = (created.json() as { id: string; ownerId: string }).id;
        createdDashboardIds.push(dashboardId);

        const salesManager = { 'x-bidstack-e2e-role': 'sales-manager' };
        const forbidden = 'Only the owner or an admin can modify this dashboard';
        const ownerWidget = await server.inject({
          method: 'POST',
          url: `/api/dashboards/${dashboardId}/widgets`,
          payload: { title: 'Owner widget', type: 'kpi' },
        });
        expect(ownerWidget.statusCode).toBe(201);
        const widgetId = (ownerWidget.json() as { id: string }).id;
        createdWidgetIds.push(widgetId);

        const deniedMutations = [
          server.inject({
            method: 'PATCH',
            url: `/api/dashboards/${dashboardId}`,
            headers: salesManager,
            payload: { name: 'Taken over' },
          }),
          server.inject({
            method: 'DELETE',
            url: `/api/dashboards/${dashboardId}`,
            headers: salesManager,
          }),
          server.inject({
            method: 'POST',
            url: `/api/dashboards/${dashboardId}/widgets`,
            headers: salesManager,
            payload: { title: 'Teammate widget', type: 'kpi' },
          }),
          server.inject({
            method: 'PATCH',
            url: `/api/dashboards/${dashboardId}/widgets/${widgetId}`,
            headers: salesManager,
            payload: { title: 'Taken over' },
          }),
          server.inject({
            method: 'DELETE',
            url: `/api/dashboards/${dashboardId}/widgets/${widgetId}`,
            headers: salesManager,
          }),
        ];
        for (const pending of deniedMutations) {
          const denied = await pending;
          expect(denied.statusCode).toBe(403);
          expect((denied.json() as { message: string }).message).toBe(forbidden);
        }

        const widgets = await server.inject({
          method: 'GET',
          url: `/api/dashboards/${dashboardId}/widgets`,
          headers: salesManager,
        });
        expect(widgets.statusCode).toBe(200);
        const listed = widgets.json() as Array<{ id: string; title: string }>;
        expect(listed.map((widget) => widget.id)).toEqual([widgetId]);
        expect(listed[0]?.title).toBe('Owner widget');
        const stillThere = await server.inject({
          method: 'GET',
          url: `/api/dashboards/${dashboardId}`,
        });
        expect(stillThere.statusCode).toBe(200);
        expect((stillThere.json() as { name: string }).name).toBe('Owner shared board');
      } finally {
        if (previous === undefined) delete process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER;
        else process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER = previous;
      }
    },
  );

  skipIfNoDb(
    'an org admin who does not own a shared dashboard can still add a widget',
    async () => {
      const previous = process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER;
      process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER = 'true';
      try {
        const salesManager = { 'x-bidstack-e2e-role': 'sales-manager' };
        const ownedByManager = await server.inject({
          method: 'POST',
          url: '/api/dashboards',
          headers: salesManager,
          payload: { name: 'Manager shared board', isShared: true },
        });
        expect(ownedByManager.statusCode).toBe(201);
        const managerDashboardId = (ownedByManager.json() as { id: string }).id;
        createdDashboardIds.push(managerDashboardId);

        const adminWidget = await server.inject({
          method: 'POST',
          url: `/api/dashboards/${managerDashboardId}/widgets`,
          payload: { title: 'Admin widget', type: 'kpi' },
        });
        expect(adminWidget.statusCode).toBe(201);
        const widgetId = (adminWidget.json() as { id: string }).id;
        createdWidgetIds.push(widgetId);

        const widgets = await server.inject({
          method: 'GET',
          url: `/api/dashboards/${managerDashboardId}/widgets`,
        });
        expect(widgets.statusCode).toBe(200);
        expect((widgets.json() as Array<{ id: string }>).some((w) => w.id === widgetId)).toBe(true);
      } finally {
        if (previous === undefined) delete process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER;
        else process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER = previous;
      }
    },
  );

  skipIfNoDb(
    'canEdit is true for the owner and for an admin, and false for any other reports:write user',
    async () => {
      const previous = process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER;
      process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER = 'true';
      try {
        const salesManager = { 'x-bidstack-e2e-role': 'sales-manager' };
        const ownedByManager = await server.inject({
          method: 'POST',
          url: '/api/dashboards',
          headers: salesManager,
          payload: { name: 'Manager flag board', isShared: true },
        });
        expect(ownedByManager.statusCode).toBe(201);
        const managerDashboardId = (ownedByManager.json() as { id: string }).id;
        createdDashboardIds.push(managerDashboardId);

        const managerDetail = await server.inject({
          method: 'GET',
          url: `/api/dashboards/${managerDashboardId}`,
          headers: salesManager,
        });
        expect(managerDetail.statusCode).toBe(200);
        expect((managerDetail.json() as { canEdit?: boolean }).canEdit).toBe(true);

        const adminDetail = await server.inject({
          method: 'GET',
          url: `/api/dashboards/${managerDashboardId}`,
        });
        expect(adminDetail.statusCode).toBe(200);
        expect((adminDetail.json() as { canEdit?: boolean }).canEdit).toBe(true);

        const ownedByAdmin = await server.inject({
          method: 'POST',
          url: '/api/dashboards',
          payload: { name: 'Admin flag board', isShared: true },
        });
        expect(ownedByAdmin.statusCode).toBe(201);
        const adminDashboardId = (ownedByAdmin.json() as { id: string }).id;
        createdDashboardIds.push(adminDashboardId);

        const teammateDetail = await server.inject({
          method: 'GET',
          url: `/api/dashboards/${adminDashboardId}`,
          headers: salesManager,
        });
        expect(teammateDetail.statusCode).toBe(200);
        expect((teammateDetail.json() as { canEdit?: boolean }).canEdit).toBe(false);
      } finally {
        if (previous === undefined) delete process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER;
        else process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER = previous;
      }
    },
  );
});
