// Synthetic reports for the seeded Pre-sales Command Center.
// Two opportunity queries only: open-pipeline value, and a deal count by stage.
// Ids are uuid v5 of the org id plus a key, so a second org cannot overwrite
// the first. Each report is seeded with one finished run, so opening the
// dashboard does not write a run.
import { createHash } from 'node:crypto';

import type { Prisma, PrismaClient } from '../generated/client/index.js';

export const COMMAND_CENTER_NAMESPACE = '6f0e2a14-9c3b-4d5e-8f71-0a1b2c3d4e5f';

const pipelineQuery = {
  entity: 'opportunity',
  aggregates: [{ fn: 'SUM', field: 'valueMicros' }],
  filters: {
    logic: 'AND',
    conditions: [{ field: 'stage', operator: 'notIn', value: ['closed_won', 'closed_lost'] }],
  },
} as const;

const stageQuery = {
  entity: 'opportunity',
  aggregates: [{ fn: 'COUNT', field: '*', alias: 'value' }],
  groupBy: [{ field: 'stage' }],
} as const;

export function commandCenterId(orgId: string, key: string): string {
  const namespace = Buffer.from(COMMAND_CENTER_NAMESPACE.replace(/-/g, ''), 'hex');
  const hash = createHash('sha1').update(namespace).update(`${orgId}:${key}`, 'utf8').digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function commandCenterPlan(orgId: string) {
  const pipelineReportId = commandCenterId(orgId, 'report:open-pipeline');
  const stageReportId = commandCenterId(orgId, 'report:deals-by-stage');
  return {
    dashboardId: commandCenterId(orgId, 'dashboard'),
    reports: [
      {
        id: pipelineReportId,
        name: 'Open pipeline',
        description: 'Synthetic sum of open opportunity value. Excludes closed won and closed lost.',
        chartType: 'gauge',
        query: pipelineQuery,
      },
      {
        id: stageReportId,
        name: 'Deals by stage',
        description: 'Synthetic count of opportunities grouped by stage.',
        chartType: 'bar',
        query: stageQuery,
      },
    ],
    widgets: [
      {
        id: commandCenterId(orgId, 'widget:weighted-pipeline'),
        title: 'Weighted Pipeline',
        type: 'kpi',
        reportId: pipelineReportId,
        config: { format: 'currency', subtitle: 'Sum of open opportunity value' },
        position: { x: 0, y: 0, w: 3, h: 2 },
      },
      {
        id: commandCenterId(orgId, 'widget:pipeline-by-stage'),
        title: 'Pipeline by Stage',
        type: 'bar',
        reportId: stageReportId,
        config: {
          subtitle: 'Opportunity count grouped by stage',
          xKey: 'stage',
          yKey: 'value',
        },
        position: { x: 3, y: 0, w: 6, h: 4 },
      },
    ],
  };
}

const LEGACY_DASHBOARD_ID = 'da5b0000-0000-4000-8000-000000000001';
const LEGACY_WIDGET_IDS = [
  'da5b0000-0000-4000-8000-000000000011',
  'da5b0000-0000-4000-8000-000000000012',
];
const LEGACY_REPORT_IDS = [
  'da5b0000-0000-4000-8000-000000000021',
  'da5b0000-0000-4000-8000-000000000022',
];

export async function seedAnalyticsCommandCenter(
  prisma: PrismaClient,
  orgId: string,
  ownerId: string,
): Promise<number> {
  await prisma.analyticsDashboardWidget.deleteMany({
    where: { orgId, id: { in: LEGACY_WIDGET_IDS } },
  });
  await prisma.analyticsReportRun.deleteMany({
    where: { orgId, reportId: { in: LEGACY_REPORT_IDS } },
  });
  await prisma.analyticsReport.deleteMany({
    where: { orgId, id: { in: LEGACY_REPORT_IDS } },
  });
  await prisma.analyticsDashboard.deleteMany({
    where: { orgId, id: LEGACY_DASHBOARD_ID },
  });

  const plan = commandCenterPlan(orgId);
  const open = await prisma.opportunity.aggregate({
    where: {
      orgId,
      deletedAt: null,
      stage: { notIn: ['closed_won', 'closed_lost'] },
    },
    _sum: { valueMicros: true },
  });
  const stages = await prisma.opportunity.groupBy({
    by: ['stage'],
    where: { orgId, deletedAt: null },
    _count: { _all: true },
  });
  const pipelineValue = Number(open._sum.valueMicros ?? 0);
  const results = new Map<string, Prisma.InputJsonValue>([
    [plan.reports[0]!.id, [{ value: pipelineValue }]],
    [
      plan.reports[1]!.id,
      stages.map((row) => ({ stage: String(row.stage), value: row._count._all })),
    ],
  ]);

  for (const report of plan.reports) {
    await prisma.analyticsReport.upsert({
      where: { id: report.id },
      create: {
        id: report.id,
        orgId,
        ownerId,
        name: report.name,
        description: report.description,
        query: report.query,
        chartType: report.chartType,
      },
      update: {
        orgId,
        ownerId,
        name: report.name,
        description: report.description,
        query: report.query,
        chartType: report.chartType,
        deletedAt: null,
      },
    });
    const result = results.get(report.id);
    const rows = Array.isArray(result) ? result : [];
    await prisma.analyticsReportRun.deleteMany({ where: { orgId, reportId: report.id } });
    await prisma.analyticsReportRun.create({
      data: {
        orgId,
        reportId: report.id,
        status: 'done',
        startedAt: new Date(),
        finishedAt: new Date(),
        rowCount: rows.length,
        result: rows,
      },
    });
  }

  await prisma.analyticsDashboard.upsert({
    where: { id: plan.dashboardId },
    create: {
      id: plan.dashboardId,
      orgId,
      ownerId,
      name: 'Pre-sales Command Center',
      description: 'Pipeline health, win rate, and bid coverage at a glance.',
      isShared: true,
    },
    update: {
      orgId,
      ownerId,
      name: 'Pre-sales Command Center',
      description: 'Pipeline health, win rate, and bid coverage at a glance.',
      isShared: true,
    },
  });

  for (const widget of plan.widgets) {
    await prisma.analyticsDashboardWidget.upsert({
      where: { id: widget.id },
      create: {
        id: widget.id,
        orgId,
        dashboardId: plan.dashboardId,
        reportId: widget.reportId,
        title: widget.title,
        type: widget.type,
        config: widget.config,
        position: widget.position,
      },
      update: {
        orgId,
        dashboardId: plan.dashboardId,
        reportId: widget.reportId,
        title: widget.title,
        type: widget.type,
        config: widget.config,
        position: widget.position,
      },
    });
  }

  return plan.widgets.length;
}
