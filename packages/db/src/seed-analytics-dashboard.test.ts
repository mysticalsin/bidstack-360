// The fixture seed opens /analytics with two widgets and no reports, so every
// card renders empty. The command center must attach two synthetic opportunity
// reports: a pipeline sum, and a deal count grouped by stage.
//
// seedAnalyticsCommandCenter writes COMMAND_CENTER_REPORTS and
// COMMAND_CENTER_WIDGETS. The unit job has no Postgres, and those rows use
// stable ids, so this asserts the plan the seed writes instead of inserting
// a second copy.

import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  COMMAND_CENTER_REPORTS,
  COMMAND_CENTER_WIDGETS,
  seedAnalyticsCommandCenter,
} from './seed-analytics-dashboard.js';

describe('command center seed plan', () => {
  it('attaches a pipeline-sum report and a deal-count report to the two widgets', () => {
    const byName = new Map(COMMAND_CENTER_REPORTS.map((report) => [report.name, report]));
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

    const widgets = new Map(COMMAND_CENTER_WIDGETS.map((widget) => [widget.title, widget]));
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
});
