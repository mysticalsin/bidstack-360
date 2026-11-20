// Synthetic reports for the seeded Pre-sales Command Center.
// Two opportunity queries only: open-pipeline value, and a deal count by stage.
// Idempotent on stable ids so a re-seed attaches the reports to the existing cards.
import type { Prisma, PrismaClient } from '../generated/client/index.js';

const DASHBOARD_ID = 'da5b0000-0000-4000-8000-000000000001';
const PIPELINE_REPORT_ID = 'da5b0000-0000-4000-8000-000000000021';
const STAGE_REPORT_ID = 'da5b0000-0000-4000-8000-000000000022';

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

export async function seedAnalyticsCommandCenter(
  prisma: PrismaClient,
  orgId: string,
  ownerId: string,
): Promise<number> {
  const reports: Array<{
    id: string;
    name: string;
    description: string;
    chartType: string;
    query: Prisma.InputJsonValue;
  }> = [
    {
      id: PIPELINE_REPORT_ID,
      name: 'Open pipeline',
      description: 'Synthetic sum of open opportunity value. Excludes closed won and closed lost.',
      chartType: 'gauge',
      query: pipelineQuery,
    },
    {
      id: STAGE_REPORT_ID,
      name: 'Deals by stage',
      description: 'Synthetic count of opportunities grouped by stage.',
      chartType: 'bar',
      query: stageQuery,
    },
  ];

  for (const report of reports) {
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
        ownerId,
        name: report.name,
        description: report.description,
        query: report.query,
        chartType: report.chartType,
        deletedAt: null,
      },
    });
  }

  await prisma.analyticsDashboard.upsert({
    where: { id: DASHBOARD_ID },
    create: {
      id: DASHBOARD_ID,
      orgId,
      ownerId,
      name: 'Pre-sales Command Center',
      description: 'Pipeline health, win rate, and bid coverage at a glance.',
      isShared: true,
    },
    update: {
      name: 'Pre-sales Command Center',
      description: 'Pipeline health, win rate, and bid coverage at a glance.',
      isShared: true,
    },
  });

  const widgets: Array<{
    id: string;
    title: string;
    type: string;
    reportId: string;
    config: Prisma.InputJsonValue;
    position: Prisma.InputJsonValue;
  }> = [
    {
      id: 'da5b0000-0000-4000-8000-000000000011',
      title: 'Weighted Pipeline',
      type: 'kpi',
      reportId: PIPELINE_REPORT_ID,
      config: { format: 'currency', subtitle: 'Sum of open opportunity value' },
      position: { x: 0, y: 0, w: 3, h: 2 },
    },
    {
      id: 'da5b0000-0000-4000-8000-000000000012',
      title: 'Pipeline by Stage',
      type: 'bar',
      reportId: STAGE_REPORT_ID,
      config: {
        subtitle: 'Opportunity count grouped by stage',
        xKey: 'stage',
        yKey: 'value',
      },
      position: { x: 3, y: 0, w: 6, h: 4 },
    },
  ];

  for (const widget of widgets) {
    await prisma.analyticsDashboardWidget.upsert({
      where: { id: widget.id },
      create: {
        id: widget.id,
        orgId,
        dashboardId: DASHBOARD_ID,
        reportId: widget.reportId,
        title: widget.title,
        type: widget.type,
        config: widget.config,
        position: widget.position,
      },
      update: {
        reportId: widget.reportId,
        title: widget.title,
        type: widget.type,
        config: widget.config,
        position: widget.position,
      },
    });
  }

  return widgets.length;
}
