import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@bidstack/db';
import { createHash, randomBytes } from 'node:crypto';

import { requiredScopeForTool, toolScopes, tools, type ToolName } from './index.js';

const hasDb = !!process.env.DATABASE_URL;
const describeDb = hasDb ? describe : describe.skip;

const prisma = new PrismaClient();

describe('MCP tool scopes', () => {
  it('declares a read/write/kam scope for every registered tool', () => {
    for (const name of Object.keys(tools) as ToolName[]) {
      expect(toolScopes[name]).toMatch(/^(read|write|kam)$/);
    }
  });

  it('keeps mutation tools write-scoped and query tools read-scoped', () => {
    expect(requiredScopeForTool('opportunity.update')).toBe('write');
    expect(requiredScopeForTool('contacts.create')).toBe('write');
    expect(requiredScopeForTool('crm_enrich_company')).toBe('write');
    expect(requiredScopeForTool('opportunities.list')).toBe('read');
    expect(requiredScopeForTool('proposal.draft')).toBe('read');
  });

  it('KAM staging-write tools use the dedicated `kam` scope, not `write`', () => {
    // The crux: a KAM agent key holds `kam` (not `write`), so it CANNOT call the
    // canonical-write tools. These must therefore be `kam`, and reads `read`.
    expect(requiredScopeForTool('kam_ingest_transcript')).toBe('kam');
    expect(requiredScopeForTool('kam_propose_session_draft')).toBe('kam');
    expect(requiredScopeForTool('kam_update_task_status')).toBe('kam');
    expect(requiredScopeForTool('kam_list_accounts')).toBe('read');
    expect(requiredScopeForTool('kam_list_initiatives')).toBe('read');
    // Canonical-write tools stay `write` — `kam` must not satisfy them.
    expect(requiredScopeForTool('notes.create')).toBe('write');
    expect(requiredScopeForTool('leads.create')).toBe('write');
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
    await prisma.activity.deleteMany({ where: { orgId } });
    await prisma.note.deleteMany({ where: { orgId } });
    await prisma.task.deleteMany({ where: { orgId } });
    await prisma.lead.deleteMany({ where: { orgId } });
    await prisma.contact.deleteMany({ where: { orgId } });
    await prisma.opportunity.deleteMany({ where: { orgId } });
    await prisma.company.deleteMany({ where: { orgId } });
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
    const row = out.find((o) => o.id === oppId) as {
      currency: null;
      currencyBasis: string;
      companyId: string | null;
      health: string;
      probability: number;
    };
    // WHY: probability is win likelihood. Reporting it as account health, or
    // the value as EUR, would make a Dust read a false forecast.
    expect(row.currency).toBeNull();
    expect(row.currencyBasis).toBe('unspecified');
    expect(row.health).toBe('not_account_health');
    expect(row.companyId).toBeNull();
  });

  it('opportunities.list filters by company id, not the customer string', async () => {
    // WHY: customer text is a label. Dust asking for the account must see the
    // linked deal and must not see a deal that only repeats the company name.
    const company = await prisma.company.create({
      data: { orgId, name: `Opp Co ${randomBytes(4).toString('hex')}` },
    });
    const linked = await prisma.opportunity.create({
      data: {
        orgId,
        code: `OP-${randomBytes(2).toString('hex')}`,
        customer: 'Stored label',
        companyId: company.id,
        name: 'Linked pursuit',
        stage: 's1_lead',
        valueMicros: 0,
        probability: 0,
        intel: {},
      },
    });
    const nameOnly = await prisma.opportunity.create({
      data: {
        orgId,
        code: `OP-${randomBytes(2).toString('hex')}`,
        customer: company.name,
        name: 'Name only pursuit',
        stage: 's1_lead',
        valueMicros: 0,
        probability: 0,
        intel: {},
      },
    });

    const out = (await tools['opportunities.list'].handler(
      { companyId: company.id, limit: 20 },
      ctx,
    )) as Array<{ id: string }>;
    expect(out.map((row) => row.id)).toEqual([linked.id]);
    expect(out.some((row) => row.id === nameOnly.id)).toBe(false);

    await expect(
      tools['opportunities.list'].handler(
        { companyId: '00000000-0000-4000-8000-000000000099', limit: 5 },
        ctx,
      ),
    ).rejects.toThrow(/not found/i);
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

  it('contacts.list returns people linked by company id, not the customer string', async () => {
    // WHY: a matching customer label is not a company link. Dust asking for
    // the account must see the linked person and must not see the name-only row.
    const company = await prisma.company.create({
      data: { orgId, name: `List Co ${randomBytes(4).toString('hex')}` },
    });
    await prisma.contact.create({
      data: { orgId, customer: 'Stored label', companyId: company.id, name: 'Linked Person' },
    });
    await prisma.contact.create({
      data: { orgId, customer: company.name, name: 'Name Only Person' },
    });

    const byName = (await tools['contacts.list'].handler(
      { customer: company.name, limit: 20 },
      ctx,
    )) as Array<{ name: string; companyId: string | null }>;
    expect(byName.map((contact) => contact.name)).toEqual(['Linked Person']);
    expect(byName[0]?.companyId).toBe(company.id);

    const byId = (await tools['contacts.list'].handler(
      { companyId: company.id, limit: 20 },
      ctx,
    )) as Array<{ name: string }>;
    expect(byId.map((contact) => contact.name)).toEqual(['Linked Person']);
  });

  it('contacts.list refuses a customer name that is not one company', async () => {
    // Names are unique per org, so the ambiguous case is two casings of one label.
    const token = randomBytes(4).toString('hex');
    await prisma.company.create({ data: { orgId, name: `Twin ${token}` } });
    await prisma.company.create({ data: { orgId, name: `twin ${token}` } });
    await expect(
      tools['contacts.list'].handler({ customer: `Missing ${token}` }, ctx),
    ).rejects.toThrow(/company id/);
    await expect(
      tools['contacts.list'].handler({ customer: `Twin ${token}` }, ctx),
    ).rejects.toThrow(/company id/);
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

  it('proposal.draft returns grounded markdown', async () => {
    const out = (await tools['proposal.draft'].handler(
      { oppId, section: 'executive_summary' as const, tone: 'consultative' as const },
      ctx,
    )) as { markdown: string };
    expect(typeof out.markdown).toBe('string');
    expect(out.markdown).toContain('Source-grounded MCP draft');
    expect(out.markdown).not.toMatch(/stub|DUST_API_KEY|ANTHROPIC_API_KEY/i);
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
    const company = await prisma.company.create({
      data: { orgId, name: 'Acme Inc Tools' },
    });
    const out = (await tools['contacts.create'].handler(
      { customer: 'ignored', companyId: company.id, name: 'Alice Smith', email: 'alice@acme.com' },
      ctx,
    )) as { id: string; name: string; companyId: string | null };
    expect(out.name).toBe('Alice Smith');
    expect(out.companyId).toBe(company.id);

    const audit = await prisma.auditLog.findFirst({
      where: { orgId, targetType: 'contact', action: 'contact.create.mcp' },
      orderBy: { at: 'desc' },
    });
    expect(audit).toBeTruthy();
  });

  it('contacts.create refuses a name that is not one company', async () => {
    await expect(
      tools['contacts.create'].handler({ customer: 'Nobody Ltd', name: 'No Link' }, ctx),
    ).rejects.toThrow(/company id/);
  });

  it('contacts.get returns a single contact', async () => {
    const company = await prisma.company.create({
      data: { orgId, name: 'Beta Corp Tools' },
    });
    const created = (await tools['contacts.create'].handler(
      { customer: company.name, name: 'Bob Jones' },
      ctx,
    )) as { id: string; companyId: string | null };
    expect(created.companyId).toBe(company.id);
    const out = (await tools['contacts.get'].handler({ id: created.id }, ctx)) as {
      id: string;
      name: string;
    };
    expect(out.id).toBe(created.id);
    expect(out.name).toBe('Bob Jones');
  });

  it('crm_list_activities returns linked events, not a customer-name match', async () => {
    // WHY: the timeline used to be follow-up tasks on opportunity.companyId.
    // A logged meeting on the account was invisible, and a deal that only
    // repeated the company name could be treated as the account.
    const company = await prisma.company.create({
      data: { orgId, name: `Activity Co ${randomBytes(4).toString('hex')}` },
    });
    const linked = await prisma.opportunity.create({
      data: {
        orgId,
        code: `OP-${randomBytes(2).toString('hex')}`,
        customer: 'Stored label',
        companyId: company.id,
        name: 'Linked pursuit',
        stage: 's1_lead',
        valueMicros: 0,
        probability: 0,
        intel: {},
      },
    });
    const nameOnly = await prisma.opportunity.create({
      data: {
        orgId,
        code: `OP-${randomBytes(2).toString('hex')}`,
        customer: company.name,
        name: 'Name only pursuit',
        stage: 's1_lead',
        valueMicros: 0,
        probability: 0,
        intel: {},
      },
    });
    const person = await prisma.contact.create({
      data: { orgId, customer: 'Stored label', companyId: company.id, name: 'Linked Person' },
    });
    const stranger = await prisma.contact.create({
      data: { orgId, customer: company.name, name: 'Name Only Person' },
    });
    await prisma.activity.create({
      data: {
        orgId,
        type: 'meeting',
        subject: 'Linked meeting',
        entityType: 'opportunity',
        entityId: linked.id,
      },
    });
    await prisma.activity.create({
      data: {
        orgId,
        type: 'call',
        subject: 'Name only call',
        entityType: 'opportunity',
        entityId: nameOnly.id,
      },
    });
    await prisma.activity.create({
      data: {
        orgId,
        type: 'note',
        subject: 'Company note',
        entityType: 'company',
        entityId: company.id,
      },
    });
    await prisma.activity.create({
      data: {
        orgId,
        type: 'email',
        subject: 'Linked email',
        entityType: 'contact',
        entityId: person.id,
      },
    });
    await prisma.activity.create({
      data: {
        orgId,
        type: 'email',
        subject: 'Name only email',
        entityType: 'contact',
        entityId: stranger.id,
      },
    });
    await prisma.task.create({
      data: { orgId, accountId: company.id, title: 'Account task' },
    });

    const out = (await tools['crm_list_activities'].handler(
      { company: company.id, limit: 20 },
      ctx,
    )) as Array<{ subject: string | null }>;
    const subjects = out.map((row) => row.subject);
    expect(subjects).toEqual(
      expect.arrayContaining(['Linked meeting', 'Company note', 'Linked email', 'Account task']),
    );
    expect(subjects).not.toContain('Name only call');
    expect(subjects).not.toContain('Name only email');

    const otherDeal = (await tools['crm_list_activities'].handler(
      { company: company.id, dealId: nameOnly.id, limit: 20 },
      ctx,
    )) as unknown[];
    expect(otherDeal).toEqual([]);
  });

  it('tasks.list includes a pursuit task through the opportunity company', async () => {
    // WHY: pursuit tasks often have only oppId. Filtering Task.accountId
    // alone hid them from Dust when it asked for the company.
    const company = await prisma.company.create({
      data: { orgId, name: `Task Co ${randomBytes(4).toString('hex')}` },
    });
    const opp = await prisma.opportunity.create({
      data: {
        orgId,
        code: `OP-${randomBytes(2).toString('hex')}`,
        customer: company.name,
        companyId: company.id,
        name: 'Linked pursuit',
        stage: 's1_lead',
        valueMicros: 0,
        probability: 0,
        intel: {},
      },
    });
    await tools['tasks.create'].handler({ oppId: opp.id, title: 'Pursuit follow-up' }, ctx);
    const out = (await tools['tasks.list'].handler({ accountId: company.id, limit: 20 }, ctx)) as Array<{
      title: string;
    }>;
    expect(out.some((task) => task.title === 'Pursuit follow-up')).toBe(true);
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
    const company = await prisma.company.create({
      data: { orgId, name: 'Notes Co' },
    });
    const out = (await tools['notes.create'].handler(
      {
        accountId: company.id,
        title: 'Meeting notes',
        bodyMd: '# Notes\n\nDiscussed pricing.',
        pinned: false,
      },
      ctx,
    )) as { id: string; title: string; companyId: string | null };
    expect(out.title).toBe('Meeting notes');
    expect(out.companyId).toBe(company.id);
    await expect(
      tools['notes.create'].handler(
        { accountId: 'Acme Inc', title: 'Nope', bodyMd: 'Name is not a link.', pinned: false },
        ctx,
      ),
    ).rejects.toThrow(/UUID/);

    const audit = await prisma.auditLog.findFirst({
      where: { orgId, targetType: 'note', action: 'note.create.mcp' },
      orderBy: { at: 'desc' },
    });
    expect(audit).toBeTruthy();
  });

  it('notes.list matches a UUID and does not resolve a company name', async () => {
    // WHY: accountId used to be free text. Guessing a name would attach the
    // wrong company's notes. The contract is the stored id.
    const accountId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
    await tools['notes.create'].handler(
      {
        accountId,
        title: 'Call notes',
        bodyMd: 'Follow up next week.',
        pinned: false,
      },
      ctx,
    );
    const out = (await tools['notes.list'].handler({ accountId, limit: 10 }, ctx)) as Array<{
      title: string;
    }>;
    expect(out.some((n) => n.title === 'Call notes')).toBe(true);
    await expect(
      tools['notes.list'].handler({ accountId: 'Beta Corp', limit: 10 }, ctx),
    ).rejects.toThrow(/UUID/);
  });

  it('crm_search_companies returns a company id and does not invent confidence for text-only matches', async () => {
    const company = await prisma.company.create({
      data: { orgId, name: 'Canonical Search Co' },
    });
    const hits = (await tools.crm_search_companies.handler(
      { query: 'Canonical Search', limit: 10 },
      ctx,
    )) as Array<{ id: string | null; matchKind: string; confidence: number | null }>;
    const canonical = hits.find((hit) => hit.id === company.id);
    expect(canonical?.matchKind).toBe('company');
    expect(canonical?.confidence).toBeNull();

    const text = (await tools.crm_search_companies.handler(
      { query: 'TestCorp', limit: 10 },
      ctx,
    )) as Array<{ matchKind: string; confidence: number | null; name: string }>;
    const onlyText = text.find((hit) => hit.name === 'TestCorp');
    expect(onlyText?.matchKind).toBe('opportunity_text_only');
    expect(onlyText?.confidence).toBeNull();
  });
});
