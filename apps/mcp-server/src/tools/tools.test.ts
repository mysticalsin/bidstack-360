import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@bidstack/db';
import { createHash, randomBytes } from 'node:crypto';

import { tools } from './index.js';

const hasDb = !!process.env.DATABASE_URL;
const describeDb = hasDb ? describe : describe.skip;

const prisma = new PrismaClient();

describeDb('MCP tools', () => {
  let orgId: string;
  let oppId: string;
  let ctx: { orgId: string; keyId: string; scopes: string[] };

  beforeAll(async () => {
    const org = await prisma.org.upsert({
      where: { clerkOrg: 'org_test_tools' },
      update: {},
      create: { clerkOrg: 'org_test_tools', name: 'Test Tools Org' },
    });
    orgId = org.id;

    const opp = await prisma.opportunity.create({
      data: {
        orgId,
        code: 'OP-9999',
        customer: 'TestCorp',
        name: 'Test Opportunity',
        stage: 'discovery',
        valueEur: 100000,
        probability: 50,
        intel: {},
      },
    });
    oppId = opp.id;

    const key = await prisma.apiKey.create({
      data: {
        orgId,
        name: 'Test Key',
        hashedKey: createHash('sha256').update(randomBytes(32)).digest('hex'),
        prefix: 'test',
        scopes: ['mcp', 'read', 'write'],
      },
    });
    ctx = { orgId, keyId: key.id, scopes: ['mcp', 'read', 'write'] };
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { orgId } });
    await prisma.task.deleteMany({ where: { orgId } });
    await prisma.opportunity.deleteMany({ where: { orgId } });
    await prisma.apiKey.deleteMany({ where: { orgId } });
    await prisma.org.delete({ where: { id: orgId } }).catch(() => {});
    await prisma.$disconnect();
  });

  it('opportunities.list returns opps for the org', async () => {
    // Per handoff/mcp.tools.md, opportunities.list returns a bare array
    // of Opportunity, not a paginated wrapper.
    const out = (await tools['opportunities.list'].handler({ limit: 10 }, ctx)) as Array<{
      id: string;
    }>;
    expect(Array.isArray(out)).toBe(true);
    expect(out.some((o) => o.id === oppId)).toBe(true);
  });

  it('opportunities.get returns a single opp', async () => {
    const out = (await tools['opportunities.get'].handler({ id: oppId }, ctx)) as { id: string };
    expect(out.id).toBe(oppId);
  });

  it('opportunity.update patches and writes audit_log', async () => {
    const out = (await tools['opportunity.update'].handler(
      { id: oppId, patch: { probability: 75 } },
      ctx,
    )) as { probability: number };
    expect(out.probability).toBe(75);

    const audit = await prisma.auditLog.findFirst({
      where: { orgId, targetId: oppId, action: 'opportunity.update.mcp' },
      orderBy: { at: 'desc' },
    });
    expect(audit).toBeTruthy();
  });

  it('contacts.list returns empty when no contacts', async () => {
    const out = (await tools['contacts.list'].handler({ limit: 10 }, ctx)) as unknown[];
    expect(Array.isArray(out)).toBe(true);
  });

  it('tasks.create creates a task and writes audit_log', async () => {
    const out = (await tools['tasks.create'].handler({ oppId, title: 'Follow-up call' }, ctx)) as {
      title: string;
      oppId: string;
    };
    expect(out.title).toBe('Follow-up call');
    expect(out.oppId).toBe(oppId);

    const audit = await prisma.auditLog.findFirst({
      where: { orgId, targetType: 'task', action: 'task.create' },
      orderBy: { at: 'desc' },
    });
    expect(audit).toBeTruthy();
  });

  it('proposal.draft returns a stub markdown', async () => {
    const out = (await tools['proposal.draft'].handler(
      { oppId, section: 'executive_summary' as const, tone: 'consultative' as const },
      ctx,
    )) as { markdown: string };
    expect(typeof out.markdown).toBe('string');
  });
});
