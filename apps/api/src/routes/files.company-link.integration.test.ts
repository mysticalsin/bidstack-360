import { afterAll, beforeAll, describe, expect } from 'vitest';

import { prisma } from '@bidstack/db';

import { buildServer } from '../server.js';
import { makeSkipIfNoDb } from '../test-support/skip-if-no-db.js';
import { resolveFileCompanyId } from './files.js';

let server: Awaited<ReturnType<typeof buildServer>>;
let dbReachable = false;

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    dbReachable = false;
    return;
  }
  server = await buildServer();
  await server.ready();
});

afterAll(async () => {
  if (server) await server.close();
  if (dbReachable) await prisma.$disconnect();
});

const skipIfNoDb = makeSkipIfNoDb(() => dbReachable);

describe('file account tags', () => {
  skipIfNoDb('a company id used as the account tag is the file link', async () => {
    // WHY: the files list matched only the free-text tag. A file already
    // linked to the company, with a different label, stayed off the account.
    const probe = await server.inject({
      method: 'POST',
      url: '/api/notes',
      payload: { accountId: `file-probe-${Date.now()}`, title: 'Probe', bodyMd: 'org' },
    });
    expect(probe.statusCode).toBe(201);
    const probeId = (probe.json() as { id: string }).id;
    const probeRow = await prisma.note.findUnique({ where: { id: probeId }, select: { orgId: true } });
    const orgId = probeRow!.orgId;
    const company = await prisma.company.create({
      data: { orgId, name: `File Co ${Date.now()}` },
    });
    const linked = await resolveFileCompanyId(orgId, company.id.toUpperCase(), null);
    expect(linked).toBe(company.id);
    expect(await resolveFileCompanyId(orgId, 'not-a-company', null)).toBeNull();

    const file = await prisma.fileAttachment.create({
      data: {
        orgId,
        accountId: `label-${Date.now()}`,
        companyId: company.id,
        name: 'brief.pdf',
        contentType: 'application/pdf',
        bytes: 12,
        storageKey: `test/file-link-${Date.now()}`,
      },
    });
    const list = await server.inject({
      method: 'GET',
      url: `/api/files?accountId=${company.id}`,
    });
    expect(list.statusCode).toBe(200);
    const ids = (list.json() as { items: Array<{ id: string }> }).items.map((item) => item.id);
    expect(ids).toContain(file.id);

    await prisma.fileAttachment.delete({ where: { id: file.id } });
    await prisma.note.delete({ where: { id: probeId } });
    await prisma.company.delete({ where: { id: company.id } });
  });
});
