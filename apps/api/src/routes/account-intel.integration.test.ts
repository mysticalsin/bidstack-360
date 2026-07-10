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
const createdFileIds: string[] = [];
const createdExtractionIds: string[] = [];
const createdSolutionIds: string[] = [];
const createdProductIds: string[] = [];

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    dbReachable = false;
    return;
  }
  const org = await createIsolatedOrg('account-intel');
  orgId = org.orgId;
  restoreAuth = useIsolatedOrgAuth(org.clerkOrg);

  server = await buildServer();
  await server.ready();
});

afterAll(async () => {
  if (dbReachable) {
    await prisma.accountSolution.deleteMany({ where: { id: { in: createdSolutionIds } } });
    await prisma.accountProduct.deleteMany({ where: { id: { in: createdProductIds } } });
    await prisma.documentExtraction.deleteMany({ where: { id: { in: createdExtractionIds } } });
    await prisma.fileAttachment.deleteMany({ where: { id: { in: createdFileIds } } });
  }
  if (server) await server.close();
  if (restoreAuth) restoreAuth();
  if (orgId) await dropIsolatedOrg(orgId);
  if (dbReachable) await prisma.$disconnect();
});

const skipIfNoDb = makeSkipIfNoDb(() => dbReachable && !!orgId);

describe('account intelligence extraction routes', () => {
  skipIfNoDb(
    'creates a pending extraction without reading/parsing the file in the API request',
    async () => {
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
    },
  );

  skipIfNoDb('returns durable fieldSources for extracted solutions and products', async () => {
    const accountId = `Intel Provenance ${Date.now()}`;
    const file = await prisma.fileAttachment.create({
      data: {
        orgId: orgId!,
        accountId,
        name: 'source-brief.pdf',
        contentType: 'application/pdf',
        bytes: 512,
        storageKey: `${orgId}/account-intel/source-brief.pdf`,
      },
    });
    createdFileIds.push(file.id);
    const extraction = await prisma.documentExtraction.create({
      data: {
        orgId: orgId!,
        accountId,
        documentId: file.id,
        status: 'done',
        extractedData: { solutions: [], products: [] },
        dustRunId: 'dust-run-123',
      },
    });
    createdExtractionIds.push(extraction.id);
    const metadata = {
      source: {
        type: 'document_extraction',
        extractionId: extraction.id,
        documentId: file.id,
        extractor: 'dust',
        dustRunId: 'dust-run-123',
      },
    };
    const [solution, product] = await Promise.all([
      prisma.accountSolution.create({
        data: {
          orgId: orgId!,
          accountId,
          name: 'Cloud modernization',
          description: 'Migration advisory',
          category: 'consulting',
          extractedFromDocumentId: file.id,
          confidenceBps: 8500,
          metadata,
        },
      }),
      prisma.accountProduct.create({
        data: {
          orgId: orgId!,
          accountId,
          name: 'Managed workspace',
          description: 'Device and collaboration management',
          category: 'service',
          extractedFromDocumentId: file.id,
          confidenceBps: 8500,
          metadata,
        },
      }),
    ]);
    createdSolutionIds.push(solution.id);
    createdProductIds.push(product.id);

    const res = await server.inject({
      method: 'GET',
      url: `/api/v1/accounts/${encodeURIComponent(accountId)}/intel`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      solutions: Array<{
        fieldSources: Record<
          string,
          { label: string; sourceFileName: string | null; sourceExtractionId: string | null }
        >;
      }>;
      products: Array<{
        fieldSources: Record<
          string,
          { label: string; sourceFileName: string | null; sourceExtractionId: string | null }
        >;
      }>;
    };
    expect(body.solutions[0]?.fieldSources.name).toMatchObject({
      label: 'Dust extraction',
      sourceFileName: 'source-brief.pdf',
      sourceExtractionId: extraction.id,
    });
    expect(body.solutions[0]?.fieldSources.description).toMatchObject({
      label: 'Dust extraction',
      sourceFileName: 'source-brief.pdf',
    });
    expect(body.products[0]?.fieldSources.priceRangeMicros).toMatchObject({
      label: 'Dust extraction',
      sourceFileName: 'source-brief.pdf',
    });
  });
});
