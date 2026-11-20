// Integration tests for analytics dashboards + widgets.
// Pattern: tasks.integration.test.ts - buildServer + inject against a
// throwaway isolated stub org; fixtures cleaned up in afterAll.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma, seedAnalyticsCommandCenter } from '@bidstack/db';

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

  skipIfNoDb(
    'a role named Admin that is not a system role does not get canEdit',
    async () => {
      const previous = process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER;
      process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER = 'true';
      const adminRole = await prisma.role.findFirstOrThrow({
        where: { orgId: orgId!, name: 'Admin', deletedAt: null },
      });
      const salesManager = { 'x-bidstack-e2e-role': 'sales-manager' };
      try {
        const owned = await server.inject({
          method: 'POST',
          url: '/api/dashboards',
          headers: salesManager,
          payload: { name: 'Owned by a sales manager', isShared: true },
        });
        expect(owned.statusCode).toBe(201);
        const dashboardId = (owned.json() as { id: string }).id;
        createdDashboardIds.push(dashboardId);

        await prisma.role.update({ where: { id: adminRole.id }, data: { isSystem: false } });
        const demoted = await server.inject({
          method: 'GET',
          url: `/api/dashboards/${dashboardId}`,
        });
        expect(demoted.statusCode).toBe(200);
        expect((demoted.json() as { canEdit: boolean }).canEdit).toBe(false);
      } finally {
        await prisma.role.update({ where: { id: adminRole.id }, data: { isSystem: true } });
        if (previous === undefined) delete process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER;
        else process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER = previous;
      }
    },
  );

  skipIfNoDb('two orgs keep separate seeded command centers, each with a run', async () => {
    const fixture = await prisma.analyticsDashboard.findUnique({
      where: { id: 'da5b0000-0000-4000-8000-000000000001' },
      select: { orgId: true, ownerId: true },
    });
    const stamp = `${Date.now()}`;
    const orgA = await prisma.org.create({
      data: { clerkOrg: `org_cc_api_a_${stamp}`, name: `API command center A ${stamp}` },
    });
    const orgB = await prisma.org.create({
      data: { clerkOrg: `org_cc_api_b_${stamp}`, name: `API command center B ${stamp}` },
    });
    const userA = await prisma.user.create({
      data: {
        orgId: orgA.id,
        clerkUser: `cc_api_a_${stamp}`,
        email: `cc-api-a-${stamp}@test.local`,
        name: 'API Owner A',
        role: 'admin',
      },
    });
    const userB = await prisma.user.create({
      data: {
        orgId: orgB.id,
        clerkUser: `cc_api_b_${stamp}`,
        email: `cc-api-b-${stamp}@test.local`,
        name: 'API Owner B',
        role: 'admin',
      },
    });
    try {
      await seedAnalyticsCommandCenter(prisma, orgA.id, userA.id);
      await seedAnalyticsCommandCenter(prisma, orgB.id, userB.id);
      for (const [org, user] of [
        [orgA, userA],
        [orgB, userB],
      ] as const) {
        const widgets = await prisma.analyticsDashboardWidget.findMany({
          where: { orgId: org.id },
          include: { report: { include: { runs: true } }, dashboard: true },
        });
        expect(widgets, org.name).toHaveLength(2);
        expect(widgets.every((widget) => widget.dashboard.orgId === org.id)).toBe(true);
        expect(widgets.every((widget) => widget.report?.orgId === org.id)).toBe(true);
        expect(widgets.every((widget) => widget.report?.ownerId === user.id)).toBe(true);
        expect(widgets.every((widget) => (widget.report?.runs.length ?? 0) >= 1)).toBe(true);
      }
      const idsA = new Set(
        (
          await prisma.analyticsDashboardWidget.findMany({
            where: { orgId: orgA.id },
            select: { id: true },
          })
        ).map((widget) => widget.id),
      );
      const idsB = await prisma.analyticsDashboardWidget.findMany({
        where: { orgId: orgB.id },
        select: { id: true },
      });
      expect(idsB.every((widget) => !idsA.has(widget.id))).toBe(true);
    } finally {
      for (const orgId of [orgA.id, orgB.id]) {
        await prisma.analyticsReportRun.deleteMany({ where: { orgId } });
        await prisma.analyticsDashboardWidget.deleteMany({ where: { orgId } });
        await prisma.analyticsReport.deleteMany({ where: { orgId } });
        await prisma.analyticsDashboard.deleteMany({ where: { orgId } });
        await prisma.user.deleteMany({ where: { orgId } });
        await prisma.org.deleteMany({ where: { id: orgId } });
      }
      if (fixture) await seedAnalyticsCommandCenter(prisma, fixture.orgId, fixture.ownerId);
    }
  });

  it('mutation routes return 2xx only when canEdit, 403 otherwise, and 404 for a hidden private dashboard', async () => {
    if (!dbReachable || !orgId) throw new Error('[skip] DATABASE_URL not reachable');
    const previous = process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER;
    process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER = 'true';
    const roles = [
      'admin',
      'manager',
      'sales-manager',
      'approver',
      'account-executive',
      'presales',
      'sdr',
      'customer-success',
      'read-only',
      'viewer',
    ] as const;
    try {
      const ownerHeaders = { 'x-bidstack-e2e-role': 'sales-manager' };
      const ownerCaps = await server.inject({
        method: 'GET',
        url: '/api/me/capabilities',
        headers: ownerHeaders,
      });
      expect(ownerCaps.statusCode).toBe(200);
      const ownerId = (ownerCaps.json() as { userId: string }).userId;

      const sharedRes = await server.inject({
        method: 'POST',
        url: '/api/dashboards',
        headers: ownerHeaders,
        payload: { name: 'Role matrix shared', isShared: true },
      });
      expect(sharedRes.statusCode).toBe(201);
      const sharedId = (sharedRes.json() as { id: string }).id;
      createdDashboardIds.push(sharedId);
      const sharedWidgetRes = await server.inject({
        method: 'POST',
        url: `/api/dashboards/${sharedId}/widgets`,
        headers: ownerHeaders,
        payload: { title: 'Shared widget', type: 'kpi' },
      });
      expect(sharedWidgetRes.statusCode).toBe(201);
      const sharedWidgetId = (sharedWidgetRes.json() as { id: string }).id;
      createdWidgetIds.push(sharedWidgetId);

      const privateRes = await server.inject({
        method: 'POST',
        url: '/api/dashboards',
        headers: ownerHeaders,
        payload: { name: 'Role matrix private', isShared: false },
      });
      expect(privateRes.statusCode).toBe(201);
      const privateId = (privateRes.json() as { id: string }).id;
      createdDashboardIds.push(privateId);
      const privateWidgetRes = await server.inject({
        method: 'POST',
        url: `/api/dashboards/${privateId}/widgets`,
        headers: ownerHeaders,
        payload: { title: 'Private widget', type: 'kpi' },
      });
      expect(privateWidgetRes.statusCode).toBe(201);
      const privateWidgetId = (privateWidgetRes.json() as { id: string }).id;
      createdWidgetIds.push(privateWidgetId);

      for (const role of roles) {
        const headers = { 'x-bidstack-e2e-role': role };
        const capsRes = await server.inject({
          method: 'GET',
          url: '/api/me/capabilities',
          headers,
        });
        expect(capsRes.statusCode, role).toBe(200);
        const caps = capsRes.json() as { userId: string; permissions: string[] };
        const systemAdmin = await prisma.userRole.count({
          where: {
            userId: caps.userId,
            orgId: orgId!,
            deletedAt: null,
            role: { orgId: orgId!, name: 'Admin', isSystem: true, deletedAt: null },
          },
        });
        const canEdit = caps.userId === ownerId || systemAdmin > 0;
        const canWrite = caps.permissions.includes('reports:write');

        for (const board of [
          { id: sharedId, widgetId: sharedWidgetId, isPrivate: false, name: 'Role matrix shared' },
          { id: privateId, widgetId: privateWidgetId, isPrivate: true, name: 'Role matrix private' },
        ]) {
          const expected = !canWrite ? 403 : board.isPrivate && !canEdit ? 404 : !canEdit ? 403 : 0;
          const label = `${role} ${board.isPrivate ? 'private' : 'shared'}`;

          if (expected !== 0) {
            const patch = await server.inject({
              method: 'PATCH',
              url: `/api/dashboards/${board.id}`,
              headers,
              payload: { name: 'Taken over' },
            });
            expect(patch.statusCode, `${label} PATCH dashboard`).toBe(expected);
            const add = await server.inject({
              method: 'POST',
              url: `/api/dashboards/${board.id}/widgets`,
              headers,
              payload: { title: 'Extra', type: 'kpi' },
            });
            expect(add.statusCode, `${label} POST widget`).toBe(expected);
            const edit = await server.inject({
              method: 'PATCH',
              url: `/api/dashboards/${board.id}/widgets/${board.widgetId}`,
              headers,
              payload: { title: 'Taken over' },
            });
            expect(edit.statusCode, `${label} PATCH widget`).toBe(expected);
            const dropWidget = await server.inject({
              method: 'DELETE',
              url: `/api/dashboards/${board.id}/widgets/${board.widgetId}`,
              headers,
            });
            expect(dropWidget.statusCode, `${label} DELETE widget`).toBe(expected);
            const dropBoard = await server.inject({
              method: 'DELETE',
              url: `/api/dashboards/${board.id}`,
              headers,
            });
            expect(dropBoard.statusCode, `${label} DELETE dashboard`).toBe(expected);
            continue;
          }

          const renamed = await server.inject({
            method: 'PATCH',
            url: `/api/dashboards/${board.id}`,
            headers,
            payload: { name: `${board.name} edited` },
          });
          expect(renamed.statusCode, `${label} PATCH dashboard`).toBe(200);
          const restored = await server.inject({
            method: 'PATCH',
            url: `/api/dashboards/${board.id}`,
            headers,
            payload: { name: board.name },
          });
          expect(restored.statusCode).toBe(200);

          const added = await server.inject({
            method: 'POST',
            url: `/api/dashboards/${board.id}/widgets`,
            headers,
            payload: { title: `${role} widget`, type: 'kpi' },
          });
          expect(added.statusCode, `${label} POST widget`).toBe(201);
          const addedId = (added.json() as { id: string }).id;
          createdWidgetIds.push(addedId);

          const edited = await server.inject({
            method: 'PATCH',
            url: `/api/dashboards/${board.id}/widgets/${board.widgetId}`,
            headers,
            payload: { title: 'Shared widget' },
          });
          expect(edited.statusCode, `${label} PATCH widget`).toBe(200);

          const removed = await server.inject({
            method: 'DELETE',
            url: `/api/dashboards/${board.id}/widgets/${addedId}`,
            headers,
          });
          expect(removed.statusCode, `${label} DELETE widget`).toBe(204);

          const disposable = await server.inject({
            method: 'POST',
            url: '/api/dashboards',
            headers: ownerHeaders,
            payload: { name: `Disposable ${role} ${board.name}`, isShared: !board.isPrivate },
          });
          expect(disposable.statusCode).toBe(201);
          const disposableId = (disposable.json() as { id: string }).id;
          createdDashboardIds.push(disposableId);
          const discarded = await server.inject({
            method: 'DELETE',
            url: `/api/dashboards/${disposableId}`,
            headers,
          });
          expect(discarded.statusCode, `${label} DELETE dashboard`).toBe(204);
        }
      }
    } finally {
      if (previous === undefined) delete process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER;
      else process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER = previous;
    }
  }, 60_000);
});
