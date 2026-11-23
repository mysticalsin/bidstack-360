// In-app bug reports, feature requests, and crash logs.
//
// Stored on audit_log (same pattern as help-article feedback) so org admins
// can read them without a new table. Actions:
//   product_report.bug | product_report.feature | product_report.crash
// A crash's signature is target_id, which sits on the existing
// (org, target type, target id) index, so a repeat from the same user is one
// row. The admin read is bounded — this inbox is a recent queue, not an export.

import type { Prisma } from '@bidstack/db';
import { prisma } from '@bidstack/db';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

const ADMIN_LIST_TAKE = 50;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const REPORT_ACTIONS = {
  bug: 'product_report.bug',
  feature: 'product_report.feature',
  crash: 'product_report.crash',
} as const;

const ClientLogSchema = z.object({
  route: z.string().trim().min(1).max(500),
  build: z.string().trim().min(1).max(200),
  browser: z.string().trim().min(1).max(400),
  timestamp: z.string().datetime(),
  recentActions: z.array(z.string().trim().min(1).max(300)).max(8).optional(),
});

const CreateBody = z
  .object({
    kind: z.enum(['bug', 'feature', 'crash']),
    featureIntent: z.enum(['new', 'improved']).optional(),
    whatDoing: z.string().trim().min(1).max(2000),
    steps: z.string().trim().max(4000).optional(),
    page: z.string().trim().min(1).max(500),
    clientLog: ClientLogSchema,
    error: z.string().trim().max(2000).optional(),
    stack: z.string().max(8000).optional(),
    signature: z
      .string()
      .regex(/^[a-f0-9]{8,64}$/)
      .optional(),
  })
  .superRefine((body, ctx) => {
    if (body.kind === 'feature' && !body.featureIntent) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['featureIntent'],
        message: 'Feature requests say whether this is new or improved',
      });
    }
    if (body.kind !== 'feature' && body.featureIntent) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['featureIntent'],
        message: 'Only feature requests carry new or improved',
      });
    }
    if (body.kind === 'crash' && !body.signature) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['signature'],
        message: 'Crash reports include a signature',
      });
    }
    if (body.kind === 'crash' && !body.error) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['error'],
        message: 'Crash reports include the error',
      });
    }
  });

const ReportItem = z.object({
  id: z.string(),
  kind: z.enum(['bug', 'feature', 'crash']),
  featureIntent: z.enum(['new', 'improved']).nullable(),
  whatDoing: z.string(),
  steps: z.string().nullable(),
  page: z.string(),
  clientLog: ClientLogSchema,
  error: z.string().nullable(),
  stack: z.string().nullable(),
  createdAt: z.string().datetime(),
  userId: z.string().nullable(),
});

const CreateResult = z.object({
  ok: z.literal(true),
  duplicate: z.boolean(),
  id: z.string(),
});

const ListResult = z.object({
  items: z.array(ReportItem),
});

const StoredDiff = z.object({
  kind: z.enum(['bug', 'feature', 'crash']),
  featureIntent: z.enum(['new', 'improved']).nullable().optional(),
  whatDoing: z.string(),
  steps: z.string().nullable().optional(),
  page: z.string(),
  clientLog: ClientLogSchema,
  error: z.string().nullable().optional(),
  stack: z.string().nullable().optional(),
});

export const productReportRoutes: FastifyPluginAsyncZod = async (server) => {
  server.post(
    '/product-reports',
    {
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        body: CreateBody,
        response: { 200: CreateResult },
      },
    },
    async (req) => {
      const body = req.body;
      const userId = UUID_RE.test(req.auth.userId) ? req.auth.userId : null;
      const action = REPORT_ACTIONS[body.kind];
      const signature = body.kind === 'crash' ? (body.signature ?? null) : null;

      if (body.kind === 'crash' && signature && userId) {
        const existing = await prisma.auditLog.findFirst({
          where: {
            orgId: req.auth.orgId,
            userId,
            action,
            targetType: 'product_report',
            targetId: signature,
          },
          select: { id: true },
        });
        if (existing) {
          return { ok: true as const, duplicate: true, id: existing.id.toString() };
        }
      }

      const clientLog: Prisma.InputJsonObject = {
        route: body.clientLog.route,
        build: body.clientLog.build,
        browser: body.clientLog.browser,
        timestamp: body.clientLog.timestamp,
        ...(body.clientLog.recentActions ? { recentActions: body.clientLog.recentActions } : {}),
      };

      const row = await prisma.auditLog.create({
        data: {
          orgId: req.auth.orgId,
          userId,
          action,
          targetType: 'product_report',
          targetId: signature,
          diff: {
            kind: body.kind,
            featureIntent: body.kind === 'feature' ? (body.featureIntent ?? null) : null,
            whatDoing: body.whatDoing,
            steps: body.steps && body.steps.length > 0 ? body.steps : null,
            page: body.page,
            clientLog,
            error: body.error ?? null,
            stack: body.stack ?? null,
          },
        },
        select: { id: true },
      });

      return { ok: true as const, duplicate: false, id: row.id.toString() };
    },
  );

  server.get(
    '/product-reports',
    {
      preHandler: server.requireRole('admin'),
      schema: {
        response: { 200: ListResult },
      },
    },
    async (req) => {
      const rows = await prisma.auditLog.findMany({
        where: {
          orgId: req.auth.orgId,
          targetType: 'product_report',
          action: { in: Object.values(REPORT_ACTIONS) },
        },
        orderBy: { at: 'desc' },
        take: ADMIN_LIST_TAKE,
        select: {
          id: true,
          userId: true,
          at: true,
          diff: true,
        },
      });

      const items = rows.flatMap((row) => {
        const parsed = StoredDiff.safeParse(row.diff);
        if (!parsed.success) return [];
        const diff = parsed.data;
        return [
          {
            id: row.id.toString(),
            kind: diff.kind,
            featureIntent: diff.featureIntent ?? null,
            whatDoing: diff.whatDoing,
            steps: diff.steps ?? null,
            page: diff.page,
            clientLog: diff.clientLog,
            error: diff.error ?? null,
            stack: diff.stack ?? null,
            createdAt: row.at.toISOString(),
            userId: row.userId,
          },
        ];
      });

      return { items };
    },
  );
};
