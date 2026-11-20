// The fixture seed opens /analytics with two widgets and no reports, so every
// card renders empty. The command center must attach two synthetic opportunity
// reports: a pipeline sum, and a deal count grouped by stage.
//
// seedAnalyticsCommandCenter writes COMMAND_CENTER_REPORTS and
// COMMAND_CENTER_WIDGETS. The unit job has no Postgres, and those rows use
// stable ids, so this asserts the plan the seed writes instead of inserting
// a second copy.

import { createHash, randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { commandCenterPlan, seedAnalyticsCommandCenter } from './seed-analytics-dashboard.js';

const COMMAND_CENTER_NAMESPACE = '6f0e2a14-9c3b-4d5e-8f71-0a1b2c3d4e5f';

function uuidV5(name: string, namespace: string): string {
  const ns = Buffer.from(namespace.replace(/-/g, ''), 'hex');
  const hash = createHash('sha1').update(ns).update(name, 'utf8').digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

describe('command center seed plan', () => {
  it('derives a uuid v5 id from the org id and a stable key', async () => {
    const mod = await import('./seed-analytics-dashboard.js');
    const orgId = '11111111-1111-4111-8111-111111111111';
    const plan = mod.commandCenterPlan(orgId);
    expect(plan.dashboardId).toBe(uuidV5(`${orgId}:dashboard`, COMMAND_CENTER_NAMESPACE));
    expect(plan.reports.find((report) => report.name === 'Open pipeline')?.id).toBe(
      uuidV5(`${orgId}:report:open-pipeline`, COMMAND_CENTER_NAMESPACE),
    );
    expect(plan.widgets.find((widget) => widget.title === 'Weighted Pipeline')?.id).toBe(
      uuidV5(`${orgId}:widget:weighted-pipeline`, COMMAND_CENTER_NAMESPACE),
    );
    expect(plan.dashboardId).not.toBe(mod.commandCenterPlan(`${orgId}-other`).dashboardId);
  });

  it('attaches a pipeline-sum report and a deal-count report to the two widgets', () => {
    const plan = commandCenterPlan('11111111-1111-4111-8111-111111111111');
    const byName = new Map(plan.reports.map((report) => [report.name, report]));
    const pipeline = byName.get('Open pipeline');
    const byStage = byName.get('Deals by stage');
    expect(pipeline?.query.entity).toBe('opportunity');
    expect(pipeline?.query.aggregates).toEqual(
      expect.arrayContaining([expect.objectContaining({ fn: 'SUM', field: 'valueMicros' })]),
    );
    expect(byStage?.query.entity).toBe('opportunity');
    expect(byStage?.query.aggregates).toEqual(
      expect.arrayContaining([expect.objectContaining({ fn: 'COUNT' })]),
    );
    expect(byStage?.query.groupBy).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'stage' })]),
    );

    const widgets = new Map(plan.widgets.map((widget) => [widget.title, widget]));
    expect(widgets.get('Weighted Pipeline')?.reportId).toBe(pipeline?.id);
    expect(widgets.get('Pipeline by Stage')?.reportId).toBe(byStage?.id);
    expect(widgets.get('Pipeline by Stage')?.config.xKey).toBe('stage');
  });
});

// Stable primary keys are global. Seeding a second org must not rewrite the
// first org's rows. The unit job has no DATABASE_URL, so this runs only when
// a database is configured (Devin's gate seeds, then runs this package).
describe('command center seed isolation', () => {
  it.skipIf(!process.env.DATABASE_URL)(
    'keeps a separate dashboard, reports, and widgets for each org',
    async () => {
      const { PrismaClient } = await import('../generated/client/index.js');
      const prisma = new PrismaClient();
      const fixture = await prisma.analyticsDashboard.findUnique({
        where: { id: 'da5b0000-0000-4000-8000-000000000001' },
        select: { orgId: true, ownerId: true },
      });
      const stamp = randomUUID().slice(0, 8);
      const orgA = await prisma.org.create({
        data: { clerkOrg: `org_cc_a_${stamp}`, name: `Command center A ${stamp}` },
      });
      const orgB = await prisma.org.create({
        data: { clerkOrg: `org_cc_b_${stamp}`, name: `Command center B ${stamp}` },
      });
      const userA = await prisma.user.create({
        data: {
          orgId: orgA.id,
          clerkUser: `cc_a_${stamp}`,
          email: `cc-a-${stamp}@test.local`,
          name: 'Owner A',
          role: 'admin',
        },
      });
      const userB = await prisma.user.create({
        data: {
          orgId: orgB.id,
          clerkUser: `cc_b_${stamp}`,
          email: `cc-b-${stamp}@test.local`,
          name: 'Owner B',
          role: 'admin',
        },
      });
      try {
        await seedAnalyticsCommandCenter(prisma, orgA.id, userA.id);
        await seedAnalyticsCommandCenter(prisma, orgB.id, userB.id);

        const widgetsA = await prisma.analyticsDashboardWidget.findMany({
          where: { orgId: orgA.id },
          include: { report: true, dashboard: true },
        });
        const widgetsB = await prisma.analyticsDashboardWidget.findMany({
          where: { orgId: orgB.id },
          include: { report: true, dashboard: true },
        });
        expect(widgetsA).toHaveLength(2);
        expect(widgetsB).toHaveLength(2);
        const idsA = new Set(widgetsA.map((widget) => widget.id));
        expect(widgetsB.every((widget) => !idsA.has(widget.id))).toBe(true);
        expect(widgetsA.every((widget) => widget.dashboard.orgId === orgA.id)).toBe(true);
        expect(widgetsB.every((widget) => widget.dashboard.orgId === orgB.id)).toBe(true);
        expect(widgetsA.every((widget) => widget.report?.orgId === orgA.id)).toBe(true);
        expect(widgetsB.every((widget) => widget.report?.orgId === orgB.id)).toBe(true);
        expect(widgetsA.every((widget) => widget.report?.ownerId === userA.id)).toBe(true);
        expect(widgetsB.every((widget) => widget.report?.ownerId === userB.id)).toBe(true);
      } finally {
        for (const orgId of [orgA.id, orgB.id]) {
          await prisma.analyticsDashboardWidget.deleteMany({ where: { orgId } });
          await prisma.analyticsReport.deleteMany({ where: { orgId } });
          await prisma.analyticsDashboard.deleteMany({ where: { orgId } });
          await prisma.user.deleteMany({ where: { orgId } });
          await prisma.org.deleteMany({ where: { id: orgId } });
        }
        if (fixture) await seedAnalyticsCommandCenter(prisma, fixture.orgId, fixture.ownerId);
        await prisma.$disconnect();
      }
    },
  );

  it.skipIf(!process.env.DATABASE_URL)(
    'leaves a command-center id that already belongs to another org untouched',
    async () => {
      const { PrismaClient } = await import('../generated/client/index.js');
      const prisma = new PrismaClient();
      const stamp = randomUUID().slice(0, 8);
      const orgA = await prisma.org.create({
        data: { clerkOrg: `org_cc_foreign_a_${stamp}`, name: `Foreign A ${stamp}` },
      });
      const orgB = await prisma.org.create({
        data: { clerkOrg: `org_cc_foreign_b_${stamp}`, name: `Foreign B ${stamp}` },
      });
      const userA = await prisma.user.create({
        data: {
          orgId: orgA.id,
          clerkUser: `cc_foreign_a_${stamp}`,
          email: `cc-foreign-a-${stamp}@test.local`,
          name: 'Seeder A',
          role: 'admin',
        },
      });
      const userB = await prisma.user.create({
        data: {
          orgId: orgB.id,
          clerkUser: `cc_foreign_b_${stamp}`,
          email: `cc-foreign-b-${stamp}@test.local`,
          name: 'Holder B',
          role: 'admin',
        },
      });
      const plan = commandCenterPlan(orgA.id);
      const reportId = plan.reports[0]!.id;
      const widgetId = plan.widgets[0]!.id;
      try {
        await prisma.analyticsReport.create({
          data: {
            id: reportId,
            orgId: orgB.id,
            ownerId: userB.id,
            name: 'foreign-held-report',
            query: { entity: 'opportunity' },
            chartType: 'table',
          },
        });
        await prisma.analyticsDashboard.create({
          data: {
            id: plan.dashboardId,
            orgId: orgB.id,
            ownerId: userB.id,
            name: 'foreign-held-dashboard',
            isShared: false,
          },
        });
        await prisma.analyticsDashboardWidget.create({
          data: {
            id: widgetId,
            orgId: orgB.id,
            dashboardId: plan.dashboardId,
            reportId,
            title: 'foreign-held-widget',
            type: 'kpi',
          },
        });

        await expect(seedAnalyticsCommandCenter(prisma, orgA.id, userA.id)).rejects.toThrow(
          /another org/,
        );

        const report = await prisma.analyticsReport.findUniqueOrThrow({ where: { id: reportId } });
        const dashboard = await prisma.analyticsDashboard.findUniqueOrThrow({
          where: { id: plan.dashboardId },
        });
        const widget = await prisma.analyticsDashboardWidget.findUniqueOrThrow({
          where: { id: widgetId },
        });
        expect(report.orgId).toBe(orgB.id);
        expect(report.ownerId).toBe(userB.id);
        expect(report.name).toBe('foreign-held-report');
        expect(dashboard.orgId).toBe(orgB.id);
        expect(dashboard.ownerId).toBe(userB.id);
        expect(dashboard.name).toBe('foreign-held-dashboard');
        expect(widget.orgId).toBe(orgB.id);
        expect(widget.title).toBe('foreign-held-widget');
      } finally {
        await prisma.analyticsReportRun.deleteMany({
          where: { reportId: { in: plan.reports.map((report) => report.id) } },
        });
        await prisma.analyticsDashboardWidget.deleteMany({
          where: { id: { in: plan.widgets.map((widget) => widget.id) } },
        });
        await prisma.analyticsReport.deleteMany({
          where: { id: { in: plan.reports.map((report) => report.id) } },
        });
        await prisma.analyticsDashboard.deleteMany({ where: { id: plan.dashboardId } });
        for (const orgId of [orgA.id, orgB.id]) {
          await prisma.analyticsReportRun.deleteMany({ where: { orgId } });
          await prisma.analyticsDashboardWidget.deleteMany({ where: { orgId } });
          await prisma.analyticsReport.deleteMany({ where: { orgId } });
          await prisma.analyticsDashboard.deleteMany({ where: { orgId } });
          await prisma.user.deleteMany({ where: { orgId } });
          await prisma.org.deleteMany({ where: { id: orgId } });
        }
        await prisma.$disconnect();
      }
    },
  );
});
