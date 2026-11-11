// WHY: void reads a non-terminal status and then updates by id. A signature
// that lands after that read must stay signed, and no void event is stored.

import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { prisma } from '@bidstack/db';

import { voidSignatureRequest } from './signature.service.js';

let dbReachable = false;

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    dbReachable = false;
  }
}, 30_000);

afterAll(async () => {
  await prisma.$disconnect();
});

const t = (name: string, fn: () => Promise<void>) =>
  it(name, async () => {
    if (!dbReachable) throw new Error(`[skip] ${name} — DATABASE_URL not reachable`);
    await fn();
  });

describe('void signature request', () => {
  t('a sent request becomes voided', async () => {
    const ns = `t${randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const org = await prisma.org.create({
      data: { clerkOrg: `org_sigok_${ns}`, name: `sig ${ns}` },
    });
    const document = await prisma.document.create({
      data: { orgId: org.id, name: 'proposal.pdf', kind: 'proposal', storageUrl: `s3://test/${ns}` },
    });
    const request = await prisma.signatureRequest.create({
      data: {
        orgId: org.id,
        documentId: document.id,
        provider: 'INTERNAL',
        status: 'SENT',
        recipients: [],
      },
    });
    await voidSignatureRequest({ orgId: org.id, requestId: request.id, reason: 'withdrawn' });
    const stored = await prisma.signatureRequest.findUnique({
      where: { id: request.id },
      select: { status: true, voidReason: true },
    });
    expect(stored).toMatchObject({ status: 'VOIDED', voidReason: 'withdrawn' });
    await prisma.org.delete({ where: { id: org.id } });
  });

  t('a signature that lands during void is not overwritten', async () => {
    const ns = `t${randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const org = await prisma.org.create({
      data: { clerkOrg: `org_sig_${ns}`, name: `sig ${ns}` },
    });
    const document = await prisma.document.create({
      data: { orgId: org.id, name: 'proposal.pdf', kind: 'proposal', storageUrl: `s3://test/${ns}` },
    });
    const request = await prisma.signatureRequest.create({
      data: {
        orgId: org.id,
        documentId: document.id,
        provider: 'INTERNAL',
        status: 'SENT',
        recipients: [{ email: 'signer@example.com', name: 'Dana', role: 'signer' }],
      },
    });
    const original = prisma.signatureRequest.findFirst.bind(prisma.signatureRequest);
    const read = vi.spyOn(prisma.signatureRequest, 'findFirst').mockImplementation(async (args) => {
      const row = await original(args as never);
      if (row?.id === request.id) {
        read.mockImplementation(original as never);
        await prisma.signatureRequest.update({
          where: { id: request.id },
          data: { status: 'SIGNED', completedAt: new Date() },
        });
      }
      return row;
    });

    await expect(
      voidSignatureRequest({ orgId: org.id, requestId: request.id, reason: 'late' }),
    ).rejects.toThrow(/cannot void/i);

    const stored = await prisma.signatureRequest.findUnique({
      where: { id: request.id },
      select: { status: true },
    });
    const events = await prisma.signatureEvent.count({
      where: { signatureRequestId: request.id, type: 'VOIDED' },
    });
    expect(stored?.status).toBe('SIGNED');
    expect(events).toBe(0);
    read.mockRestore();
    await prisma.org.delete({ where: { id: org.id } });
  });
});
