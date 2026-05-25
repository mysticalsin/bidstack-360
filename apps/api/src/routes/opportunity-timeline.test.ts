import { describe, expect, it, beforeAll, afterAll } from 'vitest';

import { prisma } from '@bidstack/db';

import { buildServer } from '../server.js';

let server: Awaited<ReturnType<typeof buildServer>>;
let dbReachable = false;
let orgId: string | null = null;
const createdIds = {
  opportunities: [] as string[],
  tasks: [] as string[],
  auditLogs: [] as bigint[],
};

describe('opportunity timeline', () => {
  beforeAll(async () => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      dbReachable = true;
      const org = await prisma.org.findUnique({ where: { clerkOrg: 'org_seed_mantu' } });
      orgId = org?.id ?? null;
    } catch {
      dbReachable = false;
    }
    server = await buildServer();
  });

  afterAll(async () => {
    if (dbReachable) {
      await prisma.auditLog.deleteMany({ where: { id: { in: createdIds.auditLogs } } });
      await prisma.task.deleteMany({ where: { id: { in: createdIds.tasks } } });
      await prisma.opportunity.deleteMany({ where: { id: { in: createdIds.opportunities } } });
    }
    await server.close();
    if (dbReachable) await prisma.$disconnect();
  });

  const skipIfNoDb = (name: string, fn: () => Promise<void> | void) =>
    it(name, async () => {
      if (!dbReachable || !orgId) {
      throw new Error(`[skip] ${name} - DATABASE_URL not reachable or seed org missing`);
    }
      await fn();
    });

  skipIfNoDb('returns 404 for an opportunity that does not exist', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/api/v1/opportunities/00000000-0000-0000-0000-000000000000/timeline',
      headers: { authorization: 'Bearer stub' },
    });
    expect(res.statusCode).toBe(404);
  });

  skipIfNoDb('returns timeline items for an existing opportunity', async () => {
    if (!orgId) throw new Error('seed org missing');
    const code = `TL-${crypto.randomUUID().slice(0, 8)}`;
    const opportunity = await prisma.opportunity.create({
      data: {
        orgId,
        code,
        customer: 'timeline-test',
        name: 'Timeline Test Opportunity',
        stage: 's1_lead',
      },
    });
    createdIds.opportunities.push(opportunity.id);

    const task = await prisma.task.create({
      data: {
        orgId,
        oppId: opportunity.id,
        title: 'Timeline follow-up',
        status: 'open',
      },
    });
    createdIds.tasks.push(task.id);

    const auditLog = await prisma.auditLog.create({
      data: {
        orgId,
        action: 'opportunity.create',
        targetType: 'opportunity',
        targetId: opportunity.id,
        diff: { code },
      },
    });
    createdIds.auditLogs.push(auditLog.id);

    const res = await server.inject({
      method: 'GET',
      url: `/api/v1/opportunities/${opportunity.id}/timeline`,
      headers: { authorization: 'Bearer stub' },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'audit', text: expect.stringContaining(code) }),
        expect.objectContaining({ kind: 'task', text: 'Task created: Timeline follow-up' }),
      ]),
    );
  });
});
