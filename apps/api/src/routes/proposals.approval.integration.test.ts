import { afterAll, beforeAll, describe, expect } from 'vitest';

import { prisma } from '@bidstack/db';

import { buildServer } from '../server.js';
import {
  createIsolatedOrg,
  dropIsolatedOrg,
  useIsolatedOrgAuth,
} from '../test-support/isolated-org.js';
import { makeSkipIfNoDb } from '../test-support/skip-if-no-db.js';

let server: Awaited<ReturnType<typeof buildServer>>;
let dbReachable = false;
let orgId: string | null = null;
let restoreAuth: (() => void) | null = null;
let previousStubRoleHeader: string | undefined;

const approverHeaders = { 'x-bidstack-e2e-role': 'approver' };

beforeAll(async () => {
  previousStubRoleHeader = process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER;
  process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER = 'true';
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    dbReachable = false;
    return;
  }
  const iso = await createIsolatedOrg('proposal-approval');
  orgId = iso.orgId;
  restoreAuth = useIsolatedOrgAuth(iso.clerkOrg);
  server = await buildServer();
  await server.ready();
});

afterAll(async () => {
  if (previousStubRoleHeader === undefined) delete process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER;
  else process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER = previousStubRoleHeader;
  restoreAuth?.();
  if (server) await server.close();
  if (orgId) await dropIsolatedOrg(orgId);
  if (dbReachable) await prisma.$disconnect();
});

const skipIfNoDb = makeSkipIfNoDb(() => dbReachable && !!orgId);

describe('proposal approval gate', () => {
  skipIfNoDb('write access cannot approve, and submit emits one stable event', async () => {
    // WHY: PATCH used to accept status=approved/submitted with only
    // proposals:write, and every submit fan-out used Date.now() so a repeat
    // looked like a new decision. Dust would read a false approval.
    const created = await server.inject({
      method: 'POST',
      url: '/api/v1/proposals',
      payload: { name: 'Gate proposal' },
    });
    expect(created.statusCode).toBe(201);
    const proposal = created.json() as {
      id: string;
      version: number;
      sections: Array<{ id: string; content: string }>;
    };
    const sectionId = proposal.sections[0]!.id;

    const forged = await server.inject({
      method: 'PATCH',
      url: `/api/v1/proposals/${proposal.id}`,
      payload: { status: 'approved' },
    });
    expect(forged.statusCode).toBe(400);

    const adminApprove = await server.inject({
      method: 'POST',
      url: `/api/v1/proposals/${proposal.id}/approve`,
      payload: { attestation: 'I reviewed the commercial terms.' },
    });
    expect(adminApprove.statusCode).toBe(403);

    const approved = await server.inject({
      method: 'POST',
      url: `/api/v1/proposals/${proposal.id}/approve`,
      headers: approverHeaders,
      payload: { attestation: 'I reviewed the commercial terms.' },
    });
    expect(approved.statusCode).toBe(200);
    expect(approved.json()).toMatchObject({ status: 'approved' });

    const stored = await prisma.proposal.findUnique({ where: { id: proposal.id } });
    expect(stored?.approvedAt).toBeTruthy();
    expect(stored?.approvedByUserId).toBeTruthy();

    const edit = await server.inject({
      method: 'PATCH',
      url: `/api/v1/proposals/${proposal.id}`,
      payload: { name: 'Changed after approval' },
    });
    expect(edit.statusCode).toBe(409);

    const sectionEdit = await server.inject({
      method: 'PATCH',
      url: `/api/v1/proposals/${proposal.id}/sections/${sectionId}`,
      payload: { content: 'rewritten' },
    });
    expect(sectionEdit.statusCode).toBe(409);

    const adminSubmit = await server.inject({
      method: 'POST',
      url: `/api/v1/proposals/${proposal.id}/submit`,
    });
    expect(adminSubmit.statusCode).toBe(403);

    const submitted = await server.inject({
      method: 'POST',
      url: `/api/v1/proposals/${proposal.id}/submit`,
      headers: approverHeaders,
    });
    expect(submitted.statusCode).toBe(200);
    const submittedBody = submitted.json() as { status: string; delivery: string };
    expect(submittedBody.status).toBe('submitted');
    expect(['enqueued', 'no_subscribers', 'outcome_unknown']).toContain(submittedBody.delivery);
    expect(JSON.stringify(submittedBody)).not.toMatch(/delivered/i);

    const repeat = await server.inject({
      method: 'POST',
      url: `/api/v1/proposals/${proposal.id}/submit`,
      headers: approverHeaders,
    });
    expect(repeat.statusCode).toBe(409);

    const audits = await prisma.auditLog.findMany({
      where: { orgId: orgId!, action: 'proposal.submitted', targetId: proposal.id },
    });
    expect(audits).toHaveLength(1);
    expect(audits[0]?.diff).toMatchObject({
      eventKey: `${proposal.id}:submitted:v${proposal.version}`,
    });

    const revised = await server.inject({
      method: 'POST',
      url: `/api/v1/proposals/${proposal.id}/revise`,
    });
    expect(revised.statusCode).toBe(201);
    const revisedBody = revised.json() as {
      id: string;
      status: string;
      version: number;
      sections: Array<{ content: string }>;
    };
    expect(revisedBody.id).not.toBe(proposal.id);
    expect(revisedBody.status).toBe('draft');
    expect(revisedBody.version).toBe(proposal.version + 1);
    expect(revisedBody.sections[0]?.content).toBe(proposal.sections[0]?.content);

    const original = await prisma.proposal.findUnique({ where: { id: proposal.id } });
    expect(original?.status).toBe('submitted');
    expect(original?.name).toBe('Gate proposal');
    expect(original?.version).toBe(proposal.version);
  });
});
