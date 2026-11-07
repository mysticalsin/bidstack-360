// Integration tests for the public signing surface (GET/POST /api/v1/sign/:token).
// The token is the only credential, so these pin the link lifecycle: expiry,
// terminal states, soft delete, tampered tokens, tampered signature payloads,
// idempotent retries and the per-IP rate limit.

import { randomBytes, randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { prisma } from '@bidstack/db';
import type { SignatureStatus } from '@bidstack/shared';

import { buildServer } from '../server.js';
import { SIGN_LINK_TTL_DAYS } from '../services/documents/signature.service.js';

vi.mock('../services/documents/document.service.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/documents/document.service.js')>()),
  htmlToPdf: vi.fn(async () => Buffer.from('%PDF-1.4 test')),
}));

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const DAY_MS = 24 * 60 * 60 * 1000;

describe('public sign routes', () => {
  let server: Awaited<ReturnType<typeof buildServer>>;
  let orgId: string;
  let documentId: string;
  const requestIds: string[] = [];

  beforeAll(async () => {
    server = await buildServer();
    await server.ready();
    const org = await prisma.org.findFirstOrThrow({ where: { clerkOrg: 'org_seed_mantu' } });
    orgId = org.id;
    const doc = await prisma.document.create({
      data: { orgId, name: `Sign test ${randomUUID().slice(0, 8)}`, kind: 'proposal', storageUrl: 'local://sign-test.pdf' },
    });
    documentId = doc.id;
  });

  afterAll(async () => {
    await prisma.signatureEvent.deleteMany({ where: { signatureRequestId: { in: requestIds } } });
    await prisma.signatureRequest.deleteMany({ where: { id: { in: requestIds } } });
    await prisma.document.deleteMany({ where: { id: documentId } });
    await server.close();
  });

  async function makeRequest(
    opts: { status?: SignatureStatus; sentAt?: Date; deletedAt?: Date | null } = {},
  ) {
    const token = randomBytes(32).toString('hex');
    const row = await prisma.signatureRequest.create({
      data: {
        orgId,
        documentId,
        provider: 'INTERNAL',
        providerRequestId: token,
        status: opts.status ?? 'SENT',
        sentAt: opts.sentAt ?? new Date(),
        recipients: [{ email: 'signer@example.com', name: 'Dana Signer', role: 'signer' }],
        deletedAt: opts.deletedAt ?? null,
      },
    });
    requestIds.push(row.id);
    return { token, id: row.id };
  }

  const submit = (token: string, signatureDataUrl = PNG) =>
    server.inject({
      method: 'POST',
      url: `/api/v1/sign/${token}`,
      payload: { typedName: 'Dana Signer', signatureDataUrl, acceptedTerms: true },
    });

  it('GET returns the link metadata with a concrete expiry', async () => {
    const sentAt = new Date();
    const { token } = await makeRequest({ sentAt });
    const res = await server.inject({ method: 'GET', url: `/api/v1/sign/${token}` });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ expiresAt: string | null; recipientName: string }>();
    expect(body.recipientName).toBe('Dana Signer');
    expect(body.expiresAt).not.toBeNull();
    expect(new Date(body.expiresAt!).getTime()).toBe(sentAt.getTime() + SIGN_LINK_TTL_DAYS * DAY_MS);
  });

  it('GET on a link past its expiry is 410 and marks the request EXPIRED', async () => {
    const { token, id } = await makeRequest({
      sentAt: new Date(Date.now() - (SIGN_LINK_TTL_DAYS + 1) * DAY_MS),
    });
    const res = await server.inject({ method: 'GET', url: `/api/v1/sign/${token}` });
    expect(res.statusCode).toBe(410);
    expect(res.json<{ message: string }>().message).toMatch(/expired/i);
    const row = await prisma.signatureRequest.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe('EXPIRED');
  });

  it('POST on an expired link is 410 and does not sign', async () => {
    const { token, id } = await makeRequest({
      sentAt: new Date(Date.now() - (SIGN_LINK_TTL_DAYS + 1) * DAY_MS),
    });
    const res = await submit(token);
    expect(res.statusCode).toBe(410);
    const row = await prisma.signatureRequest.findUniqueOrThrow({ where: { id } });
    expect(row.status).not.toBe('SIGNED');
    expect(row.completedAt).toBeNull();
  });

  it.each(['DECLINED', 'EXPIRED', 'VOIDED'] as const)(
    'POST on a %s request is 410 and does not sign',
    async (status) => {
      const { token, id } = await makeRequest({ status });
      const res = await submit(token);
      expect(res.statusCode).toBe(410);
      const row = await prisma.signatureRequest.findUniqueOrThrow({ where: { id } });
      expect(row.status).toBe(status);
    },
  );

  it('GET and POST on a soft-deleted request are 404', async () => {
    const { token, id } = await makeRequest({ deletedAt: new Date() });
    const get = await server.inject({ method: 'GET', url: `/api/v1/sign/${token}` });
    expect(get.statusCode).toBe(404);
    const post = await submit(token);
    expect(post.statusCode).toBe(404);
    const row = await prisma.signatureRequest.findFirstOrThrow({
      where: { id, deletedAt: { not: null } },
    });
    expect(row.status).toBe('SENT');
  });

  it('a tampered token (one hex digit changed) is 404', async () => {
    const { token } = await makeRequest();
    const flipped = token.slice(0, -1) + (token.endsWith('0') ? '1' : '0');
    const res = await server.inject({ method: 'GET', url: `/api/v1/sign/${flipped}` });
    expect(res.statusCode).toBe(404);
  });

  it('POST with a non-raster signature payload is 400 and does not sign', async () => {
    const { token, id } = await makeRequest();
    const res = await submit(token, 'data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+');
    expect(res.statusCode).toBe(400);
    const row = await prisma.signatureRequest.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe('SENT');
  });

  it('POST signs once; a retry is 410 and records no second SIGNED event', async () => {
    const { token, id } = await makeRequest();
    const first = await submit(token);
    expect(first.statusCode).toBe(200);
    const retry = await submit(token);
    expect(retry.statusCode).toBe(410);
    const events = await prisma.signatureEvent.count({
      where: { signatureRequestId: id, type: 'SIGNED' },
    });
    expect(events).toBe(1);
  });

  it('POST is rate limited per IP', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 12; i++) {
      const res = await submit(randomBytes(32).toString('hex'));
      codes.push(res.statusCode);
    }
    expect(codes).toContain(429);
  });
});
