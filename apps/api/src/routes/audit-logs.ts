// Audit log read-only routes. Backend writers live across opportunities,
// Data verification, and the MCP server; this is the only consumer for the UI.
//
// Cursor pagination uses the auto-incrementing BigInt id, exposed as a string
// on the wire so JS Number precision can't mangle it.

import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { prisma, type Prisma } from '@bidstack/db';
import { AuditLogFilter, AuditLogPage } from '@bidstack/shared';

const SCAN_MULTIPLIER = 4; // overscan when applying JSON-path post-filter

export const auditLogsRoutes: FastifyPluginAsyncZod = async (server) => {
  server.get(
    '/audit-logs',
    {
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
      preHandler: server.requirePermission('audit-log:read'),
      schema: {
        querystring: AuditLogFilter,
        response: { 200: AuditLogPage },
      },
    },
    async (req) => {
      const { accountId, action, targetType, since, cursor, limit } = req.query;

      // Action filter is substring-match (case-insensitive) so the UI can
      // pass things like "opportunity" or "stage" and get a useful result.
      const where: Prisma.AuditLogWhereInput = {
        orgId: req.auth.orgId,
        ...(action ? { action: { contains: action, mode: 'insensitive' } } : {}),
        ...(targetType && targetType !== 'all' ? { targetType } : {}),
        ...(since ? { at: { gte: new Date(since) } } : {}),
        ...(accountId ? { OR: accountIdClauses(accountId) } : {}),
      };

      // When the JSON-path OR clause is in play we may have to scan more rows
      // because Prisma can't combine the JSON filter with the cursor cleanly.
      const take = (accountId ? limit * SCAN_MULTIPLIER : limit) + 1;
      const rows = await prisma.auditLog.findMany({
        where,
        include: { user: { select: { name: true, email: true } } },
        orderBy: { id: 'desc' },
        take,
        ...(cursor ? { cursor: { id: BigInt(cursor) }, skip: 1 } : {}),
      });

      const trimmed = rows.slice(0, limit);
      const hasMore = rows.length > limit;

      return {
        items: trimmed.map((row) => ({
          id: row.id.toString(),
          action: row.action,
          targetType: row.targetType,
          targetId: row.targetId,
          userId: row.userId,
          userName: row.user?.name ?? null,
          userEmail: row.user?.email ?? null,
          diff: row.diff ?? null,
          createdAt: row.at.toISOString(),
        })),
        nextCursor: hasMore ? (trimmed[trimmed.length - 1]?.id.toString() ?? null) : null,
      };
    },
  );
};

// Build the OR clauses for accountId matching. We test:
//   - targetId equals accountId (opportunity.update / stage rows)
//   - diff -> 'accountId' equals accountId (data verification / MCP rows)
//   - diff -> 'opportunityId' equals accountId (defensive — some writers stamp
//     the linked opportunity instead of an explicit accountId)
function accountIdClauses(accountId: string): Prisma.AuditLogWhereInput[] {
  return [
    { targetId: accountId },
    { diff: { path: ['accountId'], equals: accountId } },
    { diff: { path: ['opportunityId'], equals: accountId } },
  ];
}
