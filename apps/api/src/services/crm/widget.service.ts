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
  updatedAt?: Date;
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
    ...(widget.updatedAt ? { updatedAt: widget.updatedAt.toISOString() } : {}),
  };
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

export class WidgetVersionConflictError extends Error {
  readonly statusCode = 409;
  constructor() {
    super('Widget was modified since you loaded it — reload and retry');
    this.name = 'ConflictError';
  }
}

export async function persistWidgets(
  orgId: string,
  prisma: PrismaClient,
  widgets: Array<z.infer<typeof DashboardWidget> & { expectedUpdatedAt?: string }>,
): Promise<Array<z.infer<typeof DashboardWidget>>> {
  // One transaction so a version miss on any widget rolls the whole layout
  // back. Two tabs that loaded the same updatedAt otherwise each replace the
  // row, and the slower tab puts the stale title or position back.
  const persisted = await prisma.$transaction(async (tx) => {
    const rows = [];
    for (const widget of widgets) {
      const data = {
        title: widget.title,
        x: widget.x,
        y: widget.y,
        w: widget.w,
        h: widget.h,
        config: widget.config as Prisma.InputJsonValue,
      };
      if (widget.expectedUpdatedAt) {
        const claimed = await tx.dashboardWidget.updateMany({
          where: {
            orgId,
            kind: widget.kind,
            deletedAt: null,
            updatedAt: new Date(widget.expectedUpdatedAt),
          },
          data,
        });
        if (claimed.count === 0) {
          const exists = await tx.dashboardWidget.findFirst({
            where: { orgId, kind: widget.kind, deletedAt: null },
            select: { id: true },
          });
          if (exists) throw new WidgetVersionConflictError();
          rows.push(
            await tx.dashboardWidget.create({
              data: { orgId, kind: widget.kind, ...data },
            }),
          );
          continue;
        }
        rows.push(
          await tx.dashboardWidget.findFirstOrThrow({
            where: { orgId, kind: widget.kind, deletedAt: null },
          }),
        );
        continue;
      }
      rows.push(
        await tx.dashboardWidget.upsert({
          where: { orgId_kind: { orgId, kind: widget.kind } },
          create: { orgId, kind: widget.kind, ...data },
          update: data,
        }),
      );
    }
    return rows;
  });
  return persisted.map(serializeWidget).sort((a, b) => (a.y === b.y ? a.x - b.x : a.y - b.y));
}
