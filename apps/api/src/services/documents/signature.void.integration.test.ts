// WHY: void reads a non-terminal status and then updates by id. A signature
// that lands after that read must stay signed, and no void event is stored.

import { createHmac, generateKeyPairSync, randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { prisma } from '@bidstack/db';

import { handleDocuSignWebhook, voidSignatureRequest } from './signature.service.js';

const docusign = vi.hoisted(() => ({ on: false, privateKey: '' }));

vi.mock('../../env.js', async (importOriginal) => {
  const actual = (await importOriginal()) as {
    getEnv: () => {
      DOCUSIGN_ACCOUNT_ID?: string;
      DOCUSIGN_INTEGRATION_KEY?: string;
      DOCUSIGN_USER_ID?: string;
      DOCUSIGN_PRIVATE_KEY?: string;
      DOCUSIGN_BASE_URL?: string;
      DOCUSIGN_WEBHOOK_HMAC_KEY?: string;
    };
  };
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
        DOCUSIGN_WEBHOOK_HMAC_KEY: 'hook-secret',
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

  t('a held completion past ten older events is still removed', async () => {
    // WHY: the cleanup reads ten signature events. Without an order, the index
    // returns the oldest ten and a completion that arrived during the void
    // stays on a voided request.
    const ns = `t${randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const org = await prisma.org.create({
      data: { clerkOrg: `org_sigord_${ns}`, name: `sig ${ns}` },
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
    const oldest = new Date('2020-01-01T00:00:00.000Z');
    for (let i = 0; i < 10; i += 1) {
      await prisma.signatureEvent.create({
        data: {
          signatureRequestId: request.id,
          type: 'SIGNED',
          occurredAt: new Date(oldest.getTime() + i * 1000),
          payload: {},
        },
      });
    }
    await prisma.signatureEvent.create({
      data: {
        signatureRequestId: request.id,
        type: 'SIGNED',
        occurredAt: new Date('2026-01-01T00:00:00.000Z'),
        payload: { heldDuringVoid: true },
      },
    });
    const findMany = vi.spyOn(prisma.signatureEvent, 'findMany');
    await voidSignatureRequest({ orgId: org.id, requestId: request.id, reason: 'withdrawn' });
    const cleanup = findMany.mock.calls
      .map((call) => call[0] as { take?: number; select?: { id?: boolean }; orderBy?: unknown })
      .find((args) => args?.take === 10 && args.select?.id === true);
    expect(cleanup?.orderBy).toEqual({ occurredAt: 'desc' });
    findMany.mockRestore();
    const signed = await prisma.signatureEvent.findMany({
      where: { signatureRequestId: request.id, type: 'SIGNED' },
      select: { payload: true },
      take: 20,
    });
    const held = signed.filter(
      (event) =>
        !!event.payload &&
        typeof event.payload === 'object' &&
        !Array.isArray(event.payload) &&
        (event.payload as { heldDuringVoid?: unknown }).heldDuringVoid === true,
    );
    expect(held).toEqual([]);
    expect(signed).toHaveLength(10);
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

  t('a completion that lands during the DocuSign void does not leave the row signed', async () => {
    // WHY: the envelope PUT is in flight while a completed webhook can still
    // try to sign. The local claim has to win first, or the envelope is
    // voided and the CRM row stays signed.
    const ns = `t${randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const org = await prisma.org.create({
      data: { clerkOrg: `org_dsp_${ns}`, name: `dsp ${ns}` },
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
      let release: () => void = () => undefined;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      let sawPut = false;
      docusign.privateKey = Buffer.from(VOID_KEY).toString('base64');
      docusign.on = true;
      vi.stubGlobal('fetch', async (url: string) => {
        if (String(url).includes('oauth/token')) {
          return new Response(JSON.stringify({ access_token: 'ds-tok', expires_in: 7200 }), { status: 200 });
        }
        sawPut = true;
        await held;
        return new Response('{}', { status: 200 });
      });
      const pending = voidSignatureRequest({ orgId: org.id, requestId: request.id, reason: 'withdrawn' });
      await vi.waitFor(() => expect(sawPut).toBe(true));
      const raw = Buffer.from(JSON.stringify({ envelopeId: `env-${ns}`, event: 'envelope-completed' }));
      const signature = createHmac('sha256', 'hook-secret').update(raw).digest('base64');
      await handleDocuSignWebhook(raw, signature, {
        envelopeId: `env-${ns}`,
        event: 'envelope-completed',
      });
      release();
      await pending;
      const stored = await prisma.signatureRequest.findUnique({
        where: { id: request.id },
        select: { status: true },
      });
      expect(stored?.status).toBe('VOIDED');
      expect(
        await prisma.signatureEvent.count({
          where: { signatureRequestId: request.id, type: 'SIGNED' },
        }),
      ).toBe(0);
    } finally {
      await prisma.org.delete({ where: { id: org.id } }).catch(() => undefined);
    }
  });

  t('a completion during a rejected void stays signed', async () => {
    // WHY: DocuSign refuses a void of an envelope that just completed. The
    // local claim still has to happen first, and the completion that arrived
    // while the claim was held has to win once the provider rejects the void.
    const ns = `t${randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const org = await prisma.org.create({
      data: { clerkOrg: `org_dsrej_${ns}`, name: `dsrej ${ns}` },
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
      let release: () => void = () => undefined;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      let sawPut = false;
      docusign.privateKey = Buffer.from(VOID_KEY).toString('base64');
      docusign.on = true;
      vi.stubGlobal('fetch', async (url: string) => {
        if (String(url).includes('oauth/token')) {
          return new Response(JSON.stringify({ access_token: 'ds-tok', expires_in: 7200 }), { status: 200 });
        }
        sawPut = true;
        await held;
        return new Response('envelope completed', { status: 400 });
      });
      const pending = voidSignatureRequest({ orgId: org.id, requestId: request.id, reason: 'withdrawn' });
      await vi.waitFor(() => expect(sawPut).toBe(true));
      const raw = Buffer.from(JSON.stringify({ envelopeId: `env-${ns}`, event: 'envelope-completed' }));
      const signature = createHmac('sha256', 'hook-secret').update(raw).digest('base64');
      await handleDocuSignWebhook(raw, signature, {
        envelopeId: `env-${ns}`,
        event: 'envelope-completed',
      });
      release();
      await expect(pending).rejects.toThrow(/DocuSign void failed/);
      const stored = await prisma.signatureRequest.findUnique({
        where: { id: request.id },
        select: { status: true, voidReason: true },
      });
      expect(stored).toMatchObject({ status: 'SIGNED', voidReason: null });
      expect(
        await prisma.signatureEvent.count({
          where: { signatureRequestId: request.id, type: 'SIGNED' },
        }),
      ).toBe(1);
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
