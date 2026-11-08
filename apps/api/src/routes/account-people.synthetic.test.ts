import sensible from '@fastify/sensible';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const orgId = '00000000-0000-4000-8000-0000000000aa';
const companyId = '00000000-0000-4000-8000-0000000000e1';
const otherCompany = '00000000-0000-4000-8000-0000000000e2';
const dealId = '00000000-0000-4000-8000-0000000000d1';
const contactId = '00000000-0000-4000-8000-0000000000c1';
const commitmentId = '00000000-0000-4000-8000-0000000000f1';
const factId = '00000000-0000-4000-8000-0000000000f2';

const db = {
  company: { findFirst: vi.fn() },
  contact: { findMany: vi.fn() },
  contactFact: { findMany: vi.fn() },
  opportunity: { findFirst: vi.fn() },
  opportunityContact: { findMany: vi.fn() },
  customerCommitment: { findFirst: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
};

vi.mock('@bidstack/db', () => ({ prisma: db }));
vi.mock('../lib/rbac-decision-cache.js', () => ({ userHasPermission: vi.fn(async () => true) }));

const { accountPeopleRoutes } = await import('./account-people.js');

async function appFor(userId: string) {
  const app = Fastify().withTypeProvider();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  await app.register(sensible);
  app.addHook('onRequest', async (req) => {
    req.auth = { orgId, userId, scopes: ['contacts:write'], role: 'api', email: 'a@example.com' };
  });
  await app.register(accountPeopleRoutes);
  return app;
}

describe('account people routes without a database', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.opportunityContact.findMany.mockResolvedValue([]);
    db.contact.findMany.mockResolvedValue([]);
  });

  it('asks for this deal and non-deal evidence before the fact limit', async () => {
    db.opportunity.findFirst.mockImplementation(async (args: { where: { id: string; orgId: string } }) => {
      if (args.where.orgId !== orgId || args.where.id !== dealId) return null;
      return { id: dealId, companyId };
    });
    const otherDeal = '00000000-0000-4000-8000-0000000000d2';
    db.opportunityContact.findMany.mockResolvedValue([
      {
        contact: { id: contactId, name: 'Ada', role: 'Buyer' },
        contactId,
        role: 'buyer',
        opportunityId: otherDeal,
        opportunity: { id: otherDeal, name: 'Other' },
      },
    ]);
    db.contactFact.findMany.mockImplementation(async (args: { where: { OR?: Array<{ opportunityId?: string }> } }) => {
      const scoped = args.where.OR?.some((branch) => branch.opportunityId === dealId);
      if (!scoped) {
        return Array.from({ length: 1000 }, (_, index) => ({
          id: factId,
          contactId,
          kind: 'buying_role',
          status: 'accepted',
          claim: 'old',
          reportsToContactId: null,
          opportunityId: '00000000-0000-4000-8000-0000000000d9',
          companyId,
          linkLabel: 'buyer',
          evidenceDetail: null,
          observedAt: new Date('2020-01-01T00:00:00.000Z'),
        })).map((row, index) => ({ ...row, id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}` }));
      }
      return [
        {
          id: factId,
          contactId,
          kind: 'buying_role',
          status: 'accepted',
          claim: 'buyer',
          reportsToContactId: null,
          opportunityId: dealId,
          companyId,
          linkLabel: 'buyer',
          evidenceDetail: null,
          observedAt: new Date(),
        },
      ];
    });
    const app = await appFor('00000000-0000-4000-8000-0000000000b1');
    const res = await app.inject({ method: 'GET', url: `/opportunities/${dealId}/people-map` });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().people[0].standing).toBe('evidenced');
    const where = db.contactFact.findMany.mock.calls[0]?.[0].where as {
      orgId: string;
      OR: Array<{ opportunityId?: string }>;
    };
    expect(where.orgId).toBe(orgId);
    expect(where.OR.some((branch) => branch.opportunityId === dealId)).toBe(true);
    const linked = where.OR.find(
      (branch) =>
        branch.opportunityId !== null &&
        typeof branch.opportunityId === 'object' &&
        'in' in (branch.opportunityId as object),
    ) as { opportunityId: { in: string[] } } | undefined;
    expect(linked?.opportunityId.in).toContain(otherDeal);
    await app.close();
  });

  it('stores a null user id when the actor is an API key', async () => {
    db.company.findFirst.mockResolvedValue({ id: companyId });
    db.customerCommitment.create.mockResolvedValue({ id: commitmentId });
    db.customerCommitment.findFirst.mockResolvedValue({
      id: commitmentId,
      promise: 'Send the brief',
      dueDate: null,
      status: 'open',
      ownerContactId: null,
      opportunityId: null,
      sourceNote: null,
      ownerContact: null,
    });
    const app = await appFor('apikey:not-a-user');
    const res = await app.inject({
      method: 'POST',
      url: `/companies/${companyId}/commitments`,
      payload: { promise: 'Send the brief' },
    });
    expect(res.statusCode).toBe(201);
    expect(db.customerCommitment.create.mock.calls[0]?.[0].data.createdByUserId).toBeNull();
    await app.close();
  });

  it('stores an ambiguous commitment as needs_review with no deal', async () => {
    // WHY: create has no status field. Ambiguous text is the only needs_review
    // path, and intake clears the deal instead of saving a linked review row.
    db.company.findFirst.mockResolvedValue({ id: companyId });
    db.customerCommitment.create.mockResolvedValue({ id: commitmentId });
    db.customerCommitment.findFirst.mockResolvedValue({
      id: commitmentId,
      promise: 'They might renew',
      dueDate: null,
      status: 'needs_review',
      ownerContactId: null,
      opportunityId: null,
      sourceNote: null,
      ownerContact: null,
    });
    const app = await appFor('00000000-0000-4000-8000-0000000000b1');
    const res = await app.inject({
      method: 'POST',
      url: `/companies/${companyId}/commitments`,
      payload: { promise: 'They might renew', ambiguous: true, opportunityId: dealId },
    });
    expect(res.statusCode).toBe(201);
    expect(db.customerCommitment.create.mock.calls[0]?.[0].data).toMatchObject({
      status: 'needs_review',
      opportunityId: null,
    });
    expect(db.opportunity.findFirst).not.toHaveBeenCalled();
    await app.close();
  });

  it('refuses a deal from another company and a deal the org filter does not return', async () => {
    db.company.findFirst.mockResolvedValue({ id: companyId });
    db.opportunity.findFirst.mockImplementation(async (args: { where: { id: string; orgId: string } }) => {
      if (args.where.orgId !== orgId) return null;
      if (args.where.id === dealId) return { id: dealId, companyId: otherCompany };
      return null;
    });
    const app = await appFor('00000000-0000-4000-8000-0000000000b1');
    const mismatch = await app.inject({
      method: 'POST',
      url: `/companies/${companyId}/commitments`,
      payload: { promise: 'Send the brief', opportunityId: dealId },
    });
    expect(mismatch.statusCode).toBe(400);
    expect(db.customerCommitment.create).not.toHaveBeenCalled();
    await app.close();
  });

  it('rejects a needs_review deal link instead of dropping it', async () => {
    db.customerCommitment.findFirst.mockResolvedValue({
      id: commitmentId,
      orgId,
      companyId,
      opportunityId: null,
      status: 'needs_review',
      deletedAt: null,
    });
    const app = await appFor('00000000-0000-4000-8000-0000000000b1');
    const res = await app.inject({
      method: 'PATCH',
      url: `/commitments/${commitmentId}`,
      payload: { opportunityId: dealId },
    });
    expect(res.statusCode).toBe(400);
    expect(db.customerCommitment.updateMany).not.toHaveBeenCalled();
    await app.close();
  });

  it('rechecks an existing deal that was not in the patch body', async () => {
    db.customerCommitment.findFirst.mockResolvedValue({
      id: commitmentId,
      orgId,
      companyId,
      opportunityId: dealId,
      status: 'open',
      deletedAt: null,
    });
    db.opportunity.findFirst.mockResolvedValue({ id: dealId, companyId: otherCompany });
    const app = await appFor('00000000-0000-4000-8000-0000000000b1');
    const res = await app.inject({
      method: 'PATCH',
      url: `/commitments/${commitmentId}`,
      payload: { promise: 'Updated promise' },
    });
    expect(res.statusCode).toBe(400);
    expect(db.customerCommitment.updateMany).not.toHaveBeenCalled();
    await app.close();
  });

  it('keeps a promise edit when the deal still belongs to the company', async () => {
    db.customerCommitment.findFirst.mockResolvedValueOnce({
      id: commitmentId,
      orgId,
      companyId,
      opportunityId: dealId,
      status: 'open',
      deletedAt: null,
    }).mockResolvedValueOnce({
      id: commitmentId,
      promise: 'Updated promise',
      dueDate: null,
      status: 'open',
      ownerContactId: null,
      opportunityId: dealId,
      sourceNote: null,
      ownerContact: null,
    });
    db.opportunity.findFirst.mockResolvedValue({ id: dealId, companyId });
    db.customerCommitment.updateMany.mockResolvedValue({ count: 1 });
    const app = await appFor('00000000-0000-4000-8000-0000000000b1');
    const res = await app.inject({
      method: 'PATCH',
      url: `/commitments/${commitmentId}`,
      payload: { promise: 'Updated promise' },
    });
    expect(res.statusCode).toBe(200);
    expect(db.customerCommitment.updateMany.mock.calls[0]?.[0].data.promise).toBe('Updated promise');
    await app.close();
  });
});
