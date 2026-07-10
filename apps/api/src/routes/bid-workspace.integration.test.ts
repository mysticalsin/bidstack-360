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
let rfpTablesReady = false;
let orgId: string | null = null;
let restoreAuth: (() => void) | null = null;
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
  const org = await createIsolatedOrg('bid-workspace');
  orgId = org.orgId;
  restoreAuth = useIsolatedOrgAuth(org.clerkOrg);
  server = await buildServer();
  await server.ready();
});

afterAll(async () => {
  if (dbReachable && rfpTablesReady) {
    await prisma.complianceMatrixRow.deleteMany({
      where: { requirement: { bidDocumentId: { in: createdIds.bidDocuments } } },
    });
    await prisma.requirement.deleteMany({
      where: { bidDocumentId: { in: createdIds.bidDocuments } },
    });
    await prisma.documentVersion.deleteMany({
      where: { bidDocumentId: { in: createdIds.bidDocuments } },
    });
    await prisma.bidDocument.deleteMany({ where: { id: { in: createdIds.bidDocuments } } });
    await prisma.documentExtraction.deleteMany({
      where: { id: { in: createdIds.documentExtractions } },
    });
    await prisma.fileAttachment.deleteMany({ where: { id: { in: createdIds.files } } });
    await prisma.opportunity.deleteMany({ where: { id: { in: createdIds.opportunities } } });
  }
  if (server) await server.close();
  if (restoreAuth) restoreAuth();
  if (orgId) await dropIsolatedOrg(orgId);
  if (dbReachable) await prisma.$disconnect();
});

const skipIfNoDb = makeSkipIfNoDb(() => dbReachable && rfpTablesReady && !!orgId);

async function createWorkspaceFixture() {
  if (!orgId) throw new Error('isolated org missing');
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
  skipIfNoDb(
    'registers a finalized file as a bid document and returns it in the workspace snapshot',
    async () => {
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
    },
  );

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

  skipIfNoDb(
    'GET /compliance returns joined requirement text and reflects saved answerDraft',
    async () => {
      const { opportunity, file } = await createWorkspaceFixture();

      // Register a document so we have a valid bidDocumentId
      const register = await server.inject({
        method: 'POST',
        url: `/api/v1/bid-workspaces/${opportunity.id}/documents`,
        payload: {
          fileAttachmentId: file.id,
          title: 'Compliance Test RFP',
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

      // Create a requirement — this also creates the linked compliance matrix row
      const createReq = await server.inject({
        method: 'POST',
        url: `/api/v1/bid-workspaces/${opportunity.id}/requirements`,
        payload: {
          bidDocumentId: document.id,
          text: 'Vendor must hold ISO 27001 certification.',
          mandatory: true,
          priority: 'high',
          confidenceBps: 8500,
        },
      });
      expect(createReq.statusCode).toBe(201);
      const { matrixRow } = createReq.json();

      // Compliance endpoint — fresh row should appear with status=pending, autoFilled=false
      const compliance1 = await server.inject({
        method: 'GET',
        url: `/api/v1/bid-workspaces/${opportunity.id}/compliance`,
      });
      expect(compliance1.statusCode).toBe(200);
      const body1 = compliance1.json();
      expect(body1.total).toBeGreaterThanOrEqual(1);
      const row1 = body1.items.find((i: { id: string }) => i.id === matrixRow.id);
      expect(row1).toBeTruthy();
      expect(row1.requirement).toBe('Vendor must hold ISO 27001 certification.');
      expect(row1.response).toBeNull();
      expect(row1.status).toBe('pending');
      expect(row1.autoFilled).toBe(false);
      expect(row1.aiConfidenceBps).toBe(8500);

      // Save an answerDraft via PATCH
      const patch = await server.inject({
        method: 'PATCH',
        url: `/api/v1/bid-workspaces/${opportunity.id}/matrix/${matrixRow.id}`,
        payload: { answerDraft: '<p>We hold ISO 27001:2022 since 2024.</p>' },
      });
      expect(patch.statusCode).toBe(200);

      // Compliance endpoint again — answerDraft should now appear as response
      const compliance2 = await server.inject({
        method: 'GET',
        url: `/api/v1/bid-workspaces/${opportunity.id}/compliance`,
      });
      expect(compliance2.statusCode).toBe(200);
      const row2 = compliance2.json().items.find((i: { id: string }) => i.id === matrixRow.id);
      expect(row2.response).toBe('<p>We hold ISO 27001:2022 since 2024.</p>');
      // autoFilled is still false — responseStatus was not changed by the PATCH
      expect(row2.autoFilled).toBe(false);
    },
  );
});
