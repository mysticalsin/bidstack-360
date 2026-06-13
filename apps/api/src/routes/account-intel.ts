import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { prisma } from '@bidstack/db';
import { DocumentExtraction, ExtractDocumentRequest, AccountIntelSnapshot } from '@bidstack/shared';
import { enqueueDocumentExtract } from '../queues/document-extract.js';

export const accountIntelRoutes: FastifyPluginAsyncZod = async (server) => {

  // RBAC: gate every route in this plugin by method — writes need 'accounts:write',
  // reads need 'accounts:read'. Runs after the global auth onRequest.
  server.addHook('preHandler', async (req) => {
    const isWrite = req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH' || req.method === 'DELETE';
    await server.requirePermission(isWrite ? 'accounts:write' : 'accounts:read')(req);
  });
  // GET /api/accounts/:accountId/intel — solutions + products + extractions
  server.get(
    '/accounts/:accountId/intel',
    {
      schema: {
        params: z.object({ accountId: z.string().min(1).max(255) }),
        response: { 200: AccountIntelSnapshot },
      },
    },
    async (req) => {
      const [solutions, products, extractions] = await Promise.all([
        prisma.accountSolution.findMany({
          where: { orgId: req.auth.orgId, accountId: req.params.accountId, deletedAt: null },
          orderBy: { updatedAt: 'desc' },
          take: 500,
        }),
        prisma.accountProduct.findMany({
          where: { orgId: req.auth.orgId, accountId: req.params.accountId, deletedAt: null },
          orderBy: { updatedAt: 'desc' },
          take: 500,
        }),
        prisma.documentExtraction.findMany({
          where: { orgId: req.auth.orgId, accountId: req.params.accountId, deletedAt: null },
          orderBy: { createdAt: 'desc' },
          take: 50,
        }),
      ]);

      return {
        solutions: solutions.map((s) => ({
          id: s.id,
          accountId: s.accountId,
          name: s.name,
          description: s.description,
          category: s.category,
          status: s.status,
          extractedFromDocumentId: s.extractedFromDocumentId,
          metadata: s.metadata as Record<string, unknown>,
          confidenceBps: s.confidenceBps,
          createdAt: s.createdAt.toISOString(),
          updatedAt: s.updatedAt.toISOString(),
        })),
        products: products.map((p) => ({
          id: p.id,
          accountId: p.accountId,
          name: p.name,
          description: p.description,
          category: p.category,
          priceRangeMicros: p.priceRangeMicros ? Number(p.priceRangeMicros) : null,
          currency: p.currency,
          status: p.status,
          extractedFromDocumentId: p.extractedFromDocumentId,
          metadata: p.metadata as Record<string, unknown>,
          confidenceBps: p.confidenceBps,
          createdAt: p.createdAt.toISOString(),
          updatedAt: p.updatedAt.toISOString(),
        })),
        extractions: extractions.map((e) => ({
          id: e.id,
          documentId: e.documentId,
          accountId: e.accountId,
          status: e.status as DocumentExtraction['status'],
          extractedData: e.extractedData as Record<string, unknown>,
          error: e.error,
          dustRunId: e.dustRunId,
          createdAt: e.createdAt.toISOString(),
          updatedAt: e.updatedAt.toISOString(),
        })),
      };
    },
  );

  // POST /api/accounts/:accountId/documents/:documentId/extract
  // Creates a pending extraction row and enqueues a worker job. Parser/OCR work
  // stays out of the API request path.
  server.post(
    '/accounts/:accountId/documents/:documentId/extract',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: {
        params: z.object({ accountId: z.string().min(1).max(255), documentId: z.string().uuid() }),
        body: ExtractDocumentRequest,
        response: { 200: DocumentExtraction },
      },
    },
    async (req) => {
      const { accountId, documentId } = req.params;

      // Verify the document exists and belongs to this org/account
      const file = await prisma.fileAttachment.findFirst({
        where: { id: documentId, orgId: req.auth.orgId, accountId, deletedAt: null },
      });
      if (!file) throw server.httpErrors.notFound('Document not found');

      // Create extraction job record
      const extraction = await prisma.documentExtraction.create({
        data: {
          orgId: req.auth.orgId,
          documentId,
          accountId,
          status: 'pending',
          extractedData: {},
        },
      });

      // Enqueue worker job (fail-open: if Redis is down, record stays pending)
      await enqueueDocumentExtract({
        orgId: req.auth.orgId,
        accountId,
        documentId,
        extractionId: extraction.id,
        storageKey: file.storageKey,
        contentType: file.contentType,
        name: file.name,
        prompt: req.body.prompt,
      });

      return {
        id: extraction.id,
        documentId: extraction.documentId,
        accountId: extraction.accountId,
        status: extraction.status as DocumentExtraction['status'],
        extractedData: extraction.extractedData as Record<string, unknown>,
        error: extraction.error,
        dustRunId: extraction.dustRunId,
        createdAt: extraction.createdAt.toISOString(),
        updatedAt: extraction.updatedAt.toISOString(),
      };
    },
  );

  // DELETE /api/accounts/:accountId/solutions/:solutionId
  server.delete(
    '/accounts/:accountId/solutions/:solutionId',
    {
      schema: {
        params: z.object({ accountId: z.string().min(1).max(255), solutionId: z.string().uuid() }),
      },
    },
    async (req) => {
      await prisma.accountSolution.updateMany({
        where: {
          id: req.params.solutionId,
          orgId: req.auth.orgId,
          accountId: req.params.accountId,
        },
        data: { deletedAt: new Date() },
      });
      return { success: true };
    },
  );

  // DELETE /api/accounts/:accountId/products/:productId
  server.delete(
    '/accounts/:accountId/products/:productId',
    {
      schema: {
        params: z.object({ accountId: z.string().min(1).max(255), productId: z.string().uuid() }),
      },
    },
    async (req) => {
      await prisma.accountProduct.updateMany({
        where: { id: req.params.productId, orgId: req.auth.orgId, accountId: req.params.accountId },
        data: { deletedAt: new Date() },
      });
      return { success: true };
    },
  );
};
