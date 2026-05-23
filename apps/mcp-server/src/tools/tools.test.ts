import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@bidstack/db';
import { createHash, randomBytes } from 'node:crypto';

import { requiredScopeForTool, toolScopes, tools, type ToolName } from './index.js';

const hasDb = !!process.env.DATABASE_URL;
const describeDb = hasDb ? describe : describe.skip;

const prisma = new PrismaClient();

describe('MCP tool scopes', () => {
  it('declares a read/write scope for every registered tool', () => {
    for (const name of Object.keys(tools) as ToolName[]) {
      expect(toolScopes[name]).toMatch(/^(read|write)$/);
    }
  });

  it('keeps mutation tools write-scoped and query tools read-scoped', () => {
    expect(requiredScopeForTool('opportunity.update')).toBe('write');
    expect(requiredScopeForTool('contacts.create')).toBe('write');
    expect(requiredScopeForTool('crm_enrich_company')).toBe('write');
    expect(requiredScopeForTool('opportunities.list')).toBe('read');
    expect(requiredScopeForTool('proposal.draft')).toBe('read');
  });
});

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

    await prisma.opportunity.deleteMany({ where: { orgId, code: 'OP-9999' } });

    const opp = await prisma.opportunity.create({
      data: {
        orgId,
        code: 'OP-9999',
        customer: 'TestCorp',
        name: 'Test Opportunity',
        stage: 's1_ongoing',
        valueMicros: 100_000_000_000,
        probability: 50,
        intel: {},
      },
    });
    oppId = opp.id;

    await prisma.user.upsert({
      where: { email: 'test-user@example.com' },
      update: {},
      create: {
        orgId,
        clerkUser: 'user_test_tools',
        email: 'test-user@example.com',
        name: 'Test User',
        role: 'admin',
      },
    });

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
    await prisma.note.deleteMany({ where: { orgId } });
    await prisma.task.deleteMany({ where: { orgId } });
    await prisma.lead.deleteMany({ where: { orgId } });
    await prisma.contact.deleteMany({ where: { orgId } });
    await prisma.opportunity.deleteMany({ where: { orgId } });
    await prisma.apiKey.deleteMany({ where: { orgId } });
    await prisma.user.deleteMany({ where: { orgId } });
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

  it('leads.create creates a lead and writes audit_log', async () => {
    const out = (await tools['leads.create'].handler(
      {
        firstName: 'Alice',
        lastName: 'Smith',
        companyName: 'Acme Inc',
        email: 'alice@acme.com',
        source: 'website',
        priority: 'medium',
        score: 0,
      },
      ctx,
    )) as { id: string; firstName: string; status: string };
    expect(out.firstName).toBe('Alice');
    expect(out.status).toBe('new');

    const audit = await prisma.auditLog.findFirst({
      where: { orgId, targetType: 'lead', action: 'lead.create.mcp' },
      orderBy: { at: 'desc' },
    });
    expect(audit).toBeTruthy();
  });

  it('leads.list returns leads for the org', async () => {
    const out = (await tools['leads.list'].handler({ limit: 10 }, ctx)) as Array<{ id: string }>;
    expect(Array.isArray(out)).toBe(true);
    expect(out.length).toBeGreaterThan(0);
  });

  it('leads.get returns a single lead', async () => {
    const created = (await tools['leads.create'].handler(
      {
        firstName: 'Bob',
        lastName: 'Jones',
        companyName: 'Beta Corp',
        source: 'website',
        priority: 'medium',
        score: 0,
      },
      ctx,
    )) as { id: string };
    const out = (await tools['leads.get'].handler({ id: created.id }, ctx)) as {
      id: string;
      firstName: string;
    };
    expect(out.id).toBe(created.id);
    expect(out.firstName).toBe('Bob');
  });

  it('leads.update patches a lead', async () => {
    const created = (await tools['leads.create'].handler(
      {
        firstName: 'Carol',
        lastName: 'White',
        companyName: 'Gamma Ltd',
        source: 'website',
        priority: 'medium',
        score: 0,
      },
      ctx,
    )) as { id: string };
    const out = (await tools['leads.update'].handler(
      { id: created.id, patch: { score: 42, status: 'qualified' } },
      ctx,
    )) as { score: number; status: string };
    expect(out.score).toBe(42);
    expect(out.status).toBe('qualified');
  });

  it('contacts.create creates a contact and writes audit_log', async () => {
    const out = (await tools['contacts.create'].handler(
      { customer: 'Acme Inc', name: 'Alice Smith', email: 'alice@acme.com' },
      ctx,
    )) as { id: string; name: string };
    expect(out.name).toBe('Alice Smith');

    const audit = await prisma.auditLog.findFirst({
      where: { orgId, targetType: 'contact', action: 'contact.create.mcp' },
      orderBy: { at: 'desc' },
    });
    expect(audit).toBeTruthy();
  });

  it('contacts.get returns a single contact', async () => {
    const created = (await tools['contacts.create'].handler(
      { customer: 'Beta Corp', name: 'Bob Jones' },
      ctx,
    )) as { id: string };
    const out = (await tools['contacts.get'].handler({ id: created.id }, ctx)) as {
      id: string;
      name: string;
    };
    expect(out.id).toBe(created.id);
    expect(out.name).toBe('Bob Jones');
  });

  it('tasks.list returns tasks for the org', async () => {
    await tools['tasks.create'].handler({ oppId, title: 'Task A' }, ctx);
    const out = (await tools['tasks.list'].handler({ limit: 10 }, ctx)) as Array<{ title: string }>;
    expect(Array.isArray(out)).toBe(true);
    expect(out.some((t) => t.title === 'Task A')).toBe(true);
  });

  it('tasks.update patches a task', async () => {
    const task = (await tools['tasks.create'].handler({ oppId, title: 'Task B' }, ctx)) as {
      id: string;
    };
    const out = (await tools['tasks.update'].handler({ id: task.id, status: 'done' }, ctx)) as {
      status: string;
    };
    expect(out.status).toBe('done');
  });

  it('notes.create creates a note and writes audit_log', async () => {
    const out = (await tools['notes.create'].handler(
      {
        accountId: 'Acme Inc',
        title: 'Meeting notes',
        bodyMd: '# Notes\n\nDiscussed pricing.',
        pinned: false,
      },
      ctx,
    )) as { id: string; title: string };
    expect(out.title).toBe('Meeting notes');

    const audit = await prisma.auditLog.findFirst({
      where: { orgId, targetType: 'note', action: 'note.create.mcp' },
      orderBy: { at: 'desc' },
    });
    expect(audit).toBeTruthy();
  });

  it('notes.list returns notes for an account', async () => {
    await tools['notes.create'].handler(
      {
        accountId: 'Beta Corp',
        title: 'Call notes',
        bodyMd: 'Follow up next week.',
        pinned: false,
      },
      ctx,
    );
    const out = (await tools['notes.list'].handler(
      { accountId: 'Beta Corp', limit: 10 },
      ctx,
    )) as Array<{
      title: string;
    }>;
    expect(Array.isArray(out)).toBe(true);
    expect(out.some((n) => n.title === 'Call notes')).toBe(true);
  });
});
