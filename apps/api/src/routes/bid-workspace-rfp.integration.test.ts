// Integration tests for PATCH /bid-workspaces/:opportunityId/draft/sections/:sectionId.
// The bid workspace edits the same proposal_sections rows as /proposals, so it
// must honour the same approval lock and tenant scope.

import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '@bidstack/db';

import { buildServer } from '../server.js';

describe('bid workspace draft section PATCH', () => {
  let server: Awaited<ReturnType<typeof buildServer>>;
  let orgId: string;
  let opportunityId: string;
  const proposalIds: string[] = [];
  const foreignOrgIds: string[] = [];

  beforeAll(async () => {
    server = await buildServer();
    await server.ready();
    const org = await prisma.org.findFirstOrThrow({ where: { clerkOrg: 'org_seed_mantu' } });
    orgId = org.id;
    const opp = await prisma.opportunity.findFirstOrThrow({
      where: { orgId, deletedAt: null },
      select: { id: true },
    });
    opportunityId = opp.id;
  });

  afterAll(async () => {
    await prisma.proposalSection.deleteMany({ where: { proposalId: { in: proposalIds } } });
    await prisma.proposal.deleteMany({ where: { id: { in: proposalIds } } });
    await prisma.org.deleteMany({ where: { id: { in: foreignOrgIds } } });
    await server.close();
  });

  async function makeProposal(status: 'draft' | 'approved' | 'submitted' | 'won' | 'lost') {
    const proposal = await prisma.proposal.create({
      data: {
        orgId,
        opportunityId,
        name: `Workspace ${status} ${randomUUID().slice(0, 8)}`,
        status,
        ...(status === 'draft' ? {} : { approvedAt: new Date() }),
        sections: {
          create: [{ orgId, key: 'executive_summary', title: 'Executive summary', content: 'Original', sortOrder: 0 }],
        },
      },
      include: { sections: true },
    });
    proposalIds.push(proposal.id);
    return { proposalId: proposal.id, sectionId: proposal.sections[0]!.id };
  }

  const patch = (sectionId: string, body: unknown, headers: Record<string, string> = {}, opp = opportunityId) =>
    server.inject({
      method: 'PATCH',
      url: `/api/v1/bid-workspaces/${opp}/draft/sections/${sectionId}`,
      headers,
      payload: body as Record<string, unknown>,
    });

  it('updates a draft section', async () => {
    const { sectionId } = await makeProposal('draft');
    const res = await patch(sectionId, { content: 'Revised draft', humanReviewed: true });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ content: string }>().content).toBe('Revised draft');
  });

  it.each(['approved', 'submitted', 'won', 'lost'] as const)(
    'is 409 on a %s proposal and leaves the approved text unchanged',
    async (status) => {
      const { sectionId } = await makeProposal(status);
      const res = await patch(sectionId, { content: 'Edited after approval', humanReviewed: true });
      expect(res.statusCode).toBe(409);
      const row = await prisma.proposalSection.findUniqueOrThrow({ where: { id: sectionId } });
      expect(row.content).toBe('Original');
    },
  );

  it('is 400 on content over the limit', async () => {
    const { sectionId } = await makeProposal('draft');
    const res = await patch(sectionId, { content: 'x'.repeat(100_001), humanReviewed: false });
    expect(res.statusCode).toBe(400);
  });

  it('is 403 for a read-only role', async () => {
    const { sectionId } = await makeProposal('draft');
    const res = await patch(
      sectionId,
      { content: 'Read only edit', humanReviewed: false },
      { 'x-bidstack-e2e-role': 'read-only' },
    );
    expect(res.statusCode).toBe(403);
  });

  it('is 404 for another org opportunity', async () => {
    const org = await prisma.org.create({
      data: { clerkOrg: `org_bw_foreign_${randomUUID()}`, name: 'Foreign Workspace Tenant' },
    });
    foreignOrgIds.push(org.id);
    const foreignOpp = await prisma.opportunity.create({
      data: {
        orgId: org.id,
        code: `XBW-${randomUUID().slice(0, 8)}`,
        customer: 'Foreign Customer',
        name: 'Foreign Workspace Opportunity',
        stage: 's1_lead',
      },
    });
    const foreignProposal = await prisma.proposal.create({
      data: {
        orgId: org.id,
        opportunityId: foreignOpp.id,
        name: 'Foreign proposal',
        sections: {
          create: [{ orgId: org.id, key: 'executive_summary', title: 'Summary', content: 'Theirs', sortOrder: 0 }],
        },
      },
      include: { sections: true },
    });
    const sectionId = foreignProposal.sections[0]!.id;
    const res = await patch(sectionId, { content: 'Hijack', humanReviewed: false }, {}, foreignOpp.id);
    expect(res.statusCode).toBe(404);
    const row = await prisma.proposalSection.findUniqueOrThrow({ where: { id: sectionId } });
    expect(row.content).toBe('Theirs');
  });

  it('a repeated identical PATCH is idempotent', async () => {
    const { sectionId } = await makeProposal('draft');
    const body = { content: 'Same text twice', humanReviewed: false };
    const first = await patch(sectionId, body);
    const second = await patch(sectionId, body);
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(second.json<{ content: string }>().content).toBe('Same text twice');
  });
});
