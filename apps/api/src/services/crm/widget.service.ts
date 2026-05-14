import { type z } from 'zod';
import type { PrismaClient, Prisma } from '@bidstack/db';
import { type DashboardWidget } from '@bidstack/shared';

export function serializeWidget(widget: {
  id: string;
  kind: string;
  title: string;
  x: number;
  y: number;
  w: number;
  h: number;
  config: unknown;
}): z.infer<typeof DashboardWidget> {
  return {
    id: widget.id,
    kind: widget.kind as z.infer<typeof DashboardWidget>['kind'],
    title: widget.title,
    x: widget.x,
    y: widget.y,
    w: widget.w,
    h: widget.h,
    config: record(widget.config),
  };
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

export async function persistWidgets(
  orgId: string,
  prisma: PrismaClient,
  widgets: Array<z.infer<typeof DashboardWidget>>,
): Promise<Array<z.infer<typeof DashboardWidget>>> {
  const persisted = await Promise.all(
    widgets.map((widget) =>
      prisma.dashboardWidget.upsert({
        where: { orgId_kind: { orgId, kind: widget.kind } },
        create: {
          orgId,
          kind: widget.kind,
          title: widget.title,
          x: widget.x,
          y: widget.y,
          w: widget.w,
          h: widget.h,
          config: widget.config as Prisma.InputJsonValue,
        },
        update: {
          title: widget.title,
          x: widget.x,
          y: widget.y,
          w: widget.w,
          h: widget.h,
          config: widget.config as Prisma.InputJsonValue,
        },
      }),
    ),
  );
  return persisted.map(serializeWidget).sort((a, b) => (a.y === b.y ? a.x - b.x : a.y - b.y));
}
