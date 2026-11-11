// WHY: the runner claims a request with compare-and-set, then writes done or
// failed by id. A row that left `running` must not be overwritten, and a
// stored status outside the four known values must be treated as failed
// without being rewritten.

import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect } from 'vitest';

import { prisma, PrismaClient, runDataSubjectRequest } from '@bidstack/db';

import { makeSkipIfNoDb } from '../test-support/skip-if-no-db.js';

let dbReachable = false;
let orgId = '';

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    dbReachable = false;
    return;
  }
  const ns = `t${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const org = await prisma.org.create({
    data: { clerkOrg: `org_dsr_race_${ns}`, name: `dsr ${ns}` },
  });
  orgId = org.id;
}, 30_000);

afterAll(async () => {
  if (orgId) await prisma.org.delete({ where: { id: orgId } }).catch(() => undefined);
});

const t = makeSkipIfNoDb(() => dbReachable && !!orgId);

async function file(status: string) {
  return prisma.dataSubjectRequest.create({
    data: {
      orgId,
      kind: 'export',
      subjectType: 'contact',
      subjectId: randomUUID(),
      dryRun: true,
      status,
    },
  });
}

describe('data subject request terminal writes', () => {
  t('maps an unknown stored status to failed and does not rewrite it', async () => {
    const row = await file('mystery');
    const out = await runDataSubjectRequest(prisma, row.id, orgId);
    expect(out.status).toBe('failed');
    const stored = await prisma.dataSubjectRequest.findFirst({ where: { id: row.id, orgId } });
    expect(stored?.status).toBe('mystery');
  });

  t('does not write failed over a row that left running', async () => {
    const row = await file('queued');
    const client = new PrismaClient();
    client.$use(async (params, next) => {
      const result = await next(params);
      if (
        params.model === 'DataSubjectRequest' &&
        params.action === 'updateMany' &&
        params.args?.data?.status === 'running'
      ) {
        // The claim won, then another finish landed before this run's terminal write.
        await prisma.dataSubjectRequest.update({
          where: { id: row.id },
          data: { status: 'done', completedAt: new Date() },
        });
      }
      return result;
    });
    try {
      const out = await runDataSubjectRequest(client, row.id, orgId);
      const stored = await prisma.dataSubjectRequest.findFirst({ where: { id: row.id, orgId } });
      expect(stored?.status).toBe('done');
      expect(out.status).not.toBe('failed');
    } finally {
      await client.$disconnect();
    }
  });
});
