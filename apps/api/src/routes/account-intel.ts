import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { prisma } from '@bidstack/db';
import { DocumentExtraction, ExtractDocumentRequest, AccountIntelSnapshot } from '@bidstack/shared';
import path from 'node:path';
import { getStorage } from '../storage/index.js';
import { extractTextFromBuffer } from '../lib/extract-text.js';
import { enqueueDocumentExtract } from '../queues/document-extract.js';

export const accountIntelRoutes: FastifyPluginAsyncZod = async (server) => {
  // GET /api/accounts/:accountId/intel — solutions + products + extractions
  server.get(
    '/accounts/:accountId/intel',
    {
      schema: {
        params: z.object({ accountId: z.string().min(1) }),
        response: { 200: AccountIntelSnapshot },
      },
    },
    async (req) => {
      const [solutions, products, extractions] = await Promise.all([
        prisma.accountSolution.findMany({
          where: { orgId: req.auth.orgId, accountId: req.params.accountId },
          orderBy: { updatedAt: 'desc' },
        }),
        prisma.accountProduct.findMany({
          where: { orgId: req.auth.orgId, accountId: req.params.accountId },
          orderBy: { updatedAt: 'desc' },
        }),
        prisma.documentExtraction.findMany({
          where: { orgId: req.auth.orgId, accountId: req.params.accountId },
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
  // Reads file, extracts text, enqueues a worker job, returns pending record.
  server.post(
    '/accounts/:accountId/documents/:documentId/extract',
    {
      schema: {
        params: z.object({ accountId: z.string().min(1), documentId: z.string().uuid() }),
        body: ExtractDocumentRequest,
        response: { 200: DocumentExtraction },
      },
    },
    async (req) => {
      const { accountId, documentId } = req.params;

      // Verify the document exists and belongs to this org/account
      const file = await prisma.fileAttachment.findFirst({
        where: { id: documentId, orgId: req.auth.orgId, accountId },
      });
      if (!file) throw server.httpErrors.notFound('Document not found');

      // Read file from storage and extract text
      const storage = await getStorage();
      const buffer = await storage.readBuffer(file.storageKey);
      const text = await extractTextFromBuffer({
        buffer,
        contentType: file.contentType,
        name: file.name,
        sourcePath:
          storage.driver === 'local'
            ? path.resolve(process.cwd(), '.uploads', file.storageKey)
            : undefined,
      });

      // Cap text length to stay within Redis job payload limits
      const MAX_TEXT_LEN = 100_000;
      const cappedText = text.length > MAX_TEXT_LEN ? text.slice(0, MAX_TEXT_LEN) : text;

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
        text: cappedText,
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
        params: z.object({ accountId: z.string().min(1), solutionId: z.string().uuid() }),
      },
    },
    async (req) => {
      await prisma.accountSolution.deleteMany({
        where: {
          id: req.params.solutionId,
          orgId: req.auth.orgId,
          accountId: req.params.accountId,
        },
      });
      return { success: true };
    },
  );

  // DELETE /api/accounts/:accountId/products/:productId
  server.delete(
    '/accounts/:accountId/products/:productId',
    {
      schema: {
        params: z.object({ accountId: z.string().min(1), productId: z.string().uuid() }),
      },
    },
    async (req) => {
      await prisma.accountProduct.deleteMany({
        where: { id: req.params.productId, orgId: req.auth.orgId, accountId: req.params.accountId },
      });
      return { success: true };
    },
  );
};
