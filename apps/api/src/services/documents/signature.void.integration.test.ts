// WHY: void reads a non-terminal status and then updates by id. A signature
// that lands after that read must stay signed, and no void event is stored.

import { generateKeyPairSync, randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { prisma } from '@bidstack/db';

import { voidSignatureRequest } from './signature.service.js';

const docusign = vi.hoisted(() => ({ on: false, privateKey: '' }));

vi.mock('../../env.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../env.js')>();
  return {
    ...actual,
    getEnv: () => {
      const env = actual.getEnv();
      if (!docusign.on) return env;
      return {
        ...env,
        DOCUSIGN_ACCOUNT_ID: 'acct-void',
        DOCUSIGN_INTEGRATION_KEY: 'ik-void',
        DOCUSIGN_USER_ID: 'user-void',
        DOCUSIGN_PRIVATE_KEY: docusign.privateKey,
        DOCUSIGN_BASE_URL: 'https://demo.docusign.net/restapi',
      };
    },
  };
});

const { privateKey: voidKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const VOID_KEY = voidKey.export({ type: 'pkcs8', format: 'pem' }).toString();

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

afterEach(() => {
  docusign.on = false;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
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

  t('a signature that lands during a DocuSign void is not voided at the provider', async () => {
    // WHY: the envelope must stay live when the local compare-and-set loses.
    // Voiding at DocuSign first leaves a signed CRM row and a dead envelope.
    const ns = `t${randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const org = await prisma.org.create({
      data: { clerkOrg: `org_ds_${ns}`, name: `ds ${ns}` },
    });
    try {
      const document = await prisma.document.create({
        data: { orgId: org.id, name: 'proposal.pdf', kind: 'proposal', storageUrl: `s3://test/${ns}` },
      });
      const request = await prisma.signatureRequest.create({
        data: {
          orgId: org.id,
          documentId: document.id,
          provider: 'DOCUSIGN',
          providerRequestId: `env-${ns}`,
          status: 'SENT',
          recipients: [],
        },
      });
      const urls: string[] = [];
      docusign.privateKey = Buffer.from(VOID_KEY).toString('base64');
      docusign.on = true;
      vi.stubGlobal('fetch', async (url: string) => {
        urls.push(String(url));
        if (String(url).includes('oauth/token')) {
          return new Response(JSON.stringify({ access_token: 'ds-tok', expires_in: 7200 }), { status: 200 });
        }
        return new Response('voided', { status: 200 });
      });
      const original = prisma.signatureRequest.findFirst.bind(prisma.signatureRequest);
      const read = vi.spyOn(prisma.signatureRequest, 'findFirst').mockImplementation(async (args) => {
        const row = await original(args as never);
        if (row?.id === request.id && row.status === 'SENT') {
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
      expect(urls.some((url) => url.includes('/envelopes/'))).toBe(false);
      const stored = await prisma.signatureRequest.findUnique({
        where: { id: request.id },
        select: { status: true },
      });
      expect(stored?.status).toBe('SIGNED');
    } finally {
      await prisma.org.delete({ where: { id: org.id } }).catch(() => undefined);
    }
  });

  t('a DocuSign failure puts the request back to the status it had', async () => {
    // WHY: the local claim happens first. If the provider refuses, the CRM
    // row must not stay voided while the envelope is still live.
    const ns = `t${randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const org = await prisma.org.create({
      data: { clerkOrg: `org_dsf_${ns}`, name: `dsf ${ns}` },
    });
    try {
      const document = await prisma.document.create({
        data: { orgId: org.id, name: 'proposal.pdf', kind: 'proposal', storageUrl: `s3://test/${ns}` },
      });
      const request = await prisma.signatureRequest.create({
        data: {
          orgId: org.id,
          documentId: document.id,
          provider: 'DOCUSIGN',
          providerRequestId: `env-${ns}`,
          status: 'SENT',
          recipients: [],
        },
      });
      docusign.privateKey = Buffer.from(VOID_KEY).toString('base64');
      docusign.on = true;
      vi.stubGlobal('fetch', async (url: string) => {
        if (String(url).includes('oauth/token')) {
          return new Response(JSON.stringify({ access_token: 'ds-tok', expires_in: 7200 }), { status: 200 });
        }
        return new Response('nope', { status: 400 });
      });
      await expect(
        voidSignatureRequest({ orgId: org.id, requestId: request.id, reason: 'withdrawn' }),
      ).rejects.toThrow(/DocuSign void failed/);
      const stored = await prisma.signatureRequest.findUnique({
        where: { id: request.id },
        select: { status: true, voidReason: true },
      });
      expect(stored).toMatchObject({ status: 'SENT', voidReason: null });
      expect(
        await prisma.signatureEvent.count({
          where: { signatureRequestId: request.id, type: 'VOIDED' },
        }),
      ).toBe(0);
    } finally {
      await prisma.org.delete({ where: { id: org.id } }).catch(() => undefined);
    }
  });
});
