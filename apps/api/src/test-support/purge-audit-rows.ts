// Test teardown only. The shared Prisma client refuses AuditLog deletes.
// Raw SQL is the retention path and does not pass through that guard.
import { Prisma, prisma } from '@bidstack/db';

type IdValue = string | bigint;

export async function purgeAuditRows(args: {
  where: {
    id?: IdValue | { in: IdValue[] };
    orgId?: string;
    targetType?: string;
    targetId?: string | { in: string[] };
    action?: string | { startsWith: string } | { in: string[] };
  };
}): Promise<void> {
  const where = args.where;
  const parts: Prisma.Sql[] = [];
  if (where.id !== undefined) {
    if (typeof where.id === 'object' && where.id !== null && 'in' in where.id) {
      if (where.id.in.length === 0) return;
      parts.push(Prisma.sql`id IN (${Prisma.join(where.id.in)})`);
    } else {
      parts.push(Prisma.sql`id = ${where.id}`);
    }
  }
  if (where.orgId !== undefined) parts.push(Prisma.sql`org_id::text = ${where.orgId}`);
  if (where.targetType !== undefined) parts.push(Prisma.sql`target_type = ${where.targetType}`);
  if (where.targetId !== undefined) {
    if (typeof where.targetId === 'object') {
      if (where.targetId.in.length === 0) return;
      parts.push(Prisma.sql`target_id IN (${Prisma.join(where.targetId.in)})`);
    } else {
      parts.push(Prisma.sql`target_id = ${where.targetId}`);
    }
  }
  if (where.action !== undefined) {
    if (typeof where.action === 'string') {
      parts.push(Prisma.sql`action = ${where.action}`);
    } else if ('startsWith' in where.action) {
      parts.push(Prisma.sql`action LIKE ${`${where.action.startsWith}%`}`);
    } else {
      if (where.action.in.length === 0) return;
      parts.push(Prisma.sql`action IN (${Prisma.join(where.action.in)})`);
    }
  }
  if (parts.length === 0) return;
  await prisma.$executeRaw`DELETE FROM audit_log WHERE ${Prisma.join(parts, ' AND ')}`;
}
