import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '@bidstack/db';

import { buildServer } from '../server.js';

let server: Awaited<ReturnType<typeof buildServer>>;
let dbReachable = false;
let rfpTablesReady = false;
let orgId: string | null = null;
const createdIds = {
  opportunities: [] as string[],
  files: [] as string[],
  bidDocuments: [] as string[],
  documentExtractions: [] as string[],
};

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
    const tableCheck = await prisma.$queryRaw<Array<{ exists: boolean }>>`
      SELECT to_regclass('public.bid_documents') IS NOT NULL AS "exists"
    `;
    rfpTablesReady = tableCheck[0]?.exists ?? false;
  } catch {
    dbReachable = false;
    return;
  }
  const org = await prisma.org.findUnique({ where: { clerkOrg: 'org_seed_mantu' } });
  orgId = org?.id ?? null;
  server = await buildServer();
  await server.ready();
});

afterAll(async () => {
  if (dbReachable && rfpTablesReady) {
    await prisma.complianceMatrixRow.deleteMany({
      where: { requirement: { bidDocumentId: { in: createdIds.bidDocuments } } },
    });
    await prisma.requirement.deleteMany({ where: { bidDocumentId: { in: createdIds.bidDocuments } } });
    await prisma.documentVersion.deleteMany({ where: { bidDocumentId: { in: createdIds.bidDocuments } } });
    await prisma.bidDocument.deleteMany({ where: { id: { in: createdIds.bidDocuments } } });
    await prisma.documentExtraction.deleteMany({ where: { id: { in: createdIds.documentExtractions } } });
    await prisma.fileAttachment.deleteMany({ where: { id: { in: createdIds.files } } });
    await prisma.opportunity.deleteMany({ where: { id: { in: createdIds.opportunities } } });
  }
  if (server) await server.close();
  if (dbReachable) await prisma.$disconnect();
});

const skipIfNoDb = (name: string, fn: () => Promise<void> | void) =>
  it(name, async () => {
    if (!dbReachable || !rfpTablesReady || !orgId) {
      throw new Error(`[skip] ${name} - DATABASE_URL or RFP tables not ready`);
    }
    await fn();
  });

async function createWorkspaceFixture() {
  if (!orgId) throw new Error('seed org missing');
  const code = `RFP-${crypto.randomUUID().slice(0, 8)}`;
  const opportunity = await prisma.opportunity.create({
    data: {
      orgId,
      code,
      customer: 'bid-workspace-test',
      name: 'Bid Workspace Test',
      stage: 's1_lead',
    },
  });
  createdIds.opportunities.push(opportunity.id);
  const file = await prisma.fileAttachment.create({
    data: {
      orgId,
      accountId: 'bid-workspace-test',
      name: 'rfp.pdf',
      contentType: 'application/pdf',
      bytes: 1024,
      storageKey: `${orgId}/bid-workspace-test/rfp.pdf`,
    },
  });
  createdIds.files.push(file.id);
  return { opportunity, file };
}

describe('bid workspace routes', () => {
  skipIfNoDb('registers a finalized file as a bid document and returns it in the workspace snapshot', async () => {
    const { opportunity, file } = await createWorkspaceFixture();

    const register = await server.inject({
      method: 'POST',
      url: `/api/v1/bid-workspaces/${opportunity.id}/documents`,
      payload: {
        fileAttachmentId: file.id,
        title: 'Primary RFP',
        documentType: 'rfp',
      },
    });
    expect(register.statusCode).toBe(201);
    const document = register.json();
    createdIds.bidDocuments.push(document.id);
    expect(document.status).toBe('pending_extraction');
    expect(document.documentType).toBe('rfp');

    const version = await prisma.documentVersion.findFirst({
      where: { orgId: orgId!, bidDocumentId: document.id, fileAttachmentId: file.id },
    });
    expect(version?.extractionStatus).toBe('pending');
    expect(version?.ocrStatus).toBe('queued');
    const extraction = await prisma.documentExtraction.findFirst({
      where: { orgId: orgId!, documentId: file.id, accountId: file.accountId },
      orderBy: { createdAt: 'desc' },
    });
    expect(extraction?.status).toBe('pending');
    if (extraction) createdIds.documentExtractions.push(extraction.id);

    const snapshot = await server.inject({
      method: 'GET',
      url: `/api/v1/bid-workspaces/${opportunity.id}`,
    });
    expect(snapshot.statusCode).toBe(200);
    const body = snapshot.json();
    expect(body.documents.some((item: { id: string }) => item.id === document.id)).toBe(true);
  });

  skipIfNoDb('blocks compliance approval until the row has source citations', async () => {
    const { opportunity, file } = await createWorkspaceFixture();
    const register = await server.inject({
      method: 'POST',
      url: `/api/v1/bid-workspaces/${opportunity.id}/documents`,
      payload: {
        fileAttachmentId: file.id,
        title: 'Security RFP',
        documentType: 'rfp',
      },
    });
    const document = register.json();
    createdIds.bidDocuments.push(document.id);
    const extraction = await prisma.documentExtraction.findFirst({
      where: { orgId: orgId!, documentId: file.id, accountId: file.accountId },
      orderBy: { createdAt: 'desc' },
    });
    if (extraction) createdIds.documentExtractions.push(extraction.id);

    const createRequirement = await server.inject({
      method: 'POST',
      url: `/api/v1/bid-workspaces/${opportunity.id}/requirements`,
      payload: {
        bidDocumentId: document.id,
        text: 'Supplier must provide SOC 2 Type II evidence.',
        mandatory: true,
        priority: 'high',
      },
    });
    expect(createRequirement.statusCode).toBe(201);
    const { matrixRow } = createRequirement.json();

    const approveWithoutCitation = await server.inject({
      method: 'PATCH',
      url: `/api/v1/bid-workspaces/${opportunity.id}/matrix/${matrixRow.id}`,
      payload: { status: 'approved' },
    });
    expect(approveWithoutCitation.statusCode).toBe(409);

    const approveWithCitation = await server.inject({
      method: 'PATCH',
      url: `/api/v1/bid-workspaces/${opportunity.id}/matrix/${matrixRow.id}`,
      payload: {
        status: 'approved',
        citations: [{ documentId: document.id, page: 12, text: 'SOC 2 Type II evidence' }],
      },
    });
    expect(approveWithCitation.statusCode).toBe(200);
    expect(approveWithCitation.json().status).toBe('approved');
  });
});
