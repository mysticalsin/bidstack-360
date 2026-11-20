// The fixture seed opens /analytics with two widgets and no reports, so every
// card renders empty. The command center must attach two synthetic opportunity
// reports: a pipeline sum, and a deal count grouped by stage.

import { randomUUID } from 'node:crypto';

import { afterAll, describe, expect, it } from 'vitest';

import { PrismaClient } from '../generated/client/index.js';

const prisma = new PrismaClient();

afterAll(async () => {
  await prisma.$disconnect();
});

describe('seeded analytics command center', () => {
  it('attaches a pipeline-sum report and a deal-count report to the two widgets', async () => {
    const mod = await import('./seed-analytics-dashboard.js').catch(() => null);
    expect(mod?.seedAnalyticsCommandCenter, 'seed must export seedAnalyticsCommandCenter').toEqual(
      expect.any(Function),
    );

    const stamp = randomUUID().slice(0, 8);
    const org = await prisma.org.create({
      data: { clerkOrg: `org_analytics_seed_${stamp}`, name: `Analytics seed ${stamp}` },
    });
    const user = await prisma.user.create({
      data: {
        orgId: org.id,
        clerkUser: `seed_analytics_${stamp}`,
        email: `analytics-seed-${stamp}@test.local`,
        name: 'Analytics Seed',
        role: 'admin',
      },
    });
    try {
      await mod!.seedAnalyticsCommandCenter(prisma, org.id, user.id);
      const widgets = await prisma.analyticsDashboardWidget.findMany({
        where: { orgId: org.id },
        include: { report: true },
        orderBy: { title: 'asc' },
      });
      const byTitle = new Map(widgets.map((widget) => [widget.title, widget]));
      const pipeline = byTitle.get('Weighted Pipeline');
      const byStage = byTitle.get('Pipeline by Stage');
      expect(pipeline?.reportId, 'Weighted Pipeline has no report').toEqual(expect.any(String));
      expect(byStage?.reportId, 'Pipeline by Stage has no report').toEqual(expect.any(String));

      const pipelineQuery = pipeline?.report?.query as {
        entity?: string;
        aggregates?: Array<{ fn?: string; field?: string }>;
      };
      const stageQuery = byStage?.report?.query as {
        entity?: string;
        aggregates?: Array<{ fn?: string; field?: string }>;
        groupBy?: Array<{ field?: string }>;
      };
      expect(pipelineQuery.entity).toBe('opportunity');
      expect(pipelineQuery.aggregates).toEqual(
        expect.arrayContaining([expect.objectContaining({ fn: 'SUM', field: 'valueMicros' })]),
      );
      expect(stageQuery.entity).toBe('opportunity');
      expect(stageQuery.aggregates).toEqual(
        expect.arrayContaining([expect.objectContaining({ fn: 'COUNT' })]),
      );
      expect(stageQuery.groupBy).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: 'stage' })]),
      );
      expect((byStage?.config as { xKey?: string }).xKey).toBe('stage');
    } finally {
      await prisma.analyticsDashboardWidget.deleteMany({ where: { orgId: org.id } });
      await prisma.analyticsReport.deleteMany({ where: { orgId: org.id } });
      await prisma.analyticsDashboard.deleteMany({ where: { orgId: org.id } });
      await prisma.user.deleteMany({ where: { id: user.id } });
      await prisma.org.deleteMany({ where: { id: org.id } });
    }
  });
});
