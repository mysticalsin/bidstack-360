import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '@bidstack/db';

import { buildServer } from '../server.js';

let server: Awaited<ReturnType<typeof buildServer>>;
let dbReachable = false;
let orgId: string | null = null;
const createdFileIds: string[] = [];
const createdExtractionIds: string[] = [];

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    dbReachable = false;
    return;
  }
  const org = await prisma.org.findUnique({ where: { clerkOrg: 'org_seed_mantu' } });
  orgId = org?.id ?? null;
  if (!orgId) return;

  server = await buildServer();
  await server.ready();
});

afterAll(async () => {
  if (dbReachable) {
    await prisma.documentExtraction.deleteMany({ where: { id: { in: createdExtractionIds } } });
    await prisma.fileAttachment.deleteMany({ where: { id: { in: createdFileIds } } });
  }
  if (server) await server.close();
  if (dbReachable) await prisma.$disconnect();
});

const skipIfNoDb = (name: string, fn: () => Promise<void> | void) =>
  it(name, async () => {
    if (!dbReachable || !orgId) {
      console.warn(`[skip] ${name} - DATABASE_URL not reachable or seed org missing`);
      return;
    }
    await fn();
  });

describe('account intelligence extraction routes', () => {
  skipIfNoDb('creates a pending extraction without reading/parsing the file in the API request', async () => {
    const accountId = `Async OCR Account ${Date.now()}`;
    const file = await prisma.fileAttachment.create({
      data: {
        orgId: orgId!,
        accountId,
        name: 'missing-but-queued.txt',
        contentType: 'text/plain',
        bytes: 128,
        storageKey: `${orgId}/async-ocr/missing-but-queued.txt`,
      },
    });
    createdFileIds.push(file.id);

    const res = await server.inject({
      method: 'POST',
      url: `/api/v1/accounts/${encodeURIComponent(accountId)}/documents/${file.id}/extract`,
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { id: string; documentId: string; status: string };
    createdExtractionIds.push(body.id);
    expect(body.documentId).toBe(file.id);
    expect(body.status).toBe('pending');
  });
});
