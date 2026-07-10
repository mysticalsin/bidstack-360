import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { prisma } from '@bidstack/db';
import {
  AccountIntelFieldProvenance,
  AccountIntelSnapshot,
  DocumentExtraction,
  ExtractDocumentRequest,
  SourceAttribution,
  type AccountIntelFieldProvenance as AccountIntelFieldProvenanceType,
  type AccountIntelFieldProvenanceSource,
} from '@bidstack/shared';
import { enqueueDocumentExtract } from '../queues/document-extract.js';
import { fetchCompanyNewsSignals } from '../providers/company-news-signal.js';
import { canReadAccount } from '../lib/account-access.js';

const SOLUTION_FIELD_KEYS = ['name', 'description', 'category', 'status'] as const;
const PRODUCT_FIELD_KEYS = [
  'name',
  'description',
  'category',
  'priceRangeMicros',
  'currency',
  'status',
] as const;

type AccountIntelFieldKey =
  | (typeof SOLUTION_FIELD_KEYS)[number]
  | (typeof PRODUCT_FIELD_KEYS)[number];

type AccountIntelSourceRow = {
  extractedFromDocumentId: string | null;
  metadata: unknown;
  confidenceBps: number;
  updatedAt: Date;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function uuidOrNull(value: unknown): string | null {
  const parsed = z.string().uuid().safeParse(value);
  return parsed.success ? parsed.data : null;
}

function storedFieldSources(metadata: unknown): Record<string, AccountIntelFieldProvenanceType> {
  const parsed = z.record(AccountIntelFieldProvenance).safeParse(record(metadata).fieldSources);
  return parsed.success ? parsed.data : {};
}

function sourceFromRow(row: AccountIntelSourceRow): {
  source: AccountIntelFieldProvenanceSource;
  sourceExtractionId: string | null;
  extractor: string | null;
} {
  if (!row.extractedFromDocumentId) {
    return { source: 'manual', sourceExtractionId: null, extractor: null };
  }

  const sourceMetadata = record(record(row.metadata).source);
  const extractor =
    typeof sourceMetadata.extractor === 'string' ? sourceMetadata.extractor.toLowerCase() : null;
  const dustRunId = typeof sourceMetadata.dustRunId === 'string' ? sourceMetadata.dustRunId : null;
  const isDust = extractor === 'dust' || Boolean(dustRunId) || row.confidenceBps >= 8000;

  return {
    source: isDust ? 'derived:dust' : 'derived:deterministic',
    sourceExtractionId: uuidOrNull(sourceMetadata.extractionId),
    extractor,
  };
}

function buildIntelFieldSources(
  row: AccountIntelSourceRow,
  fields: readonly AccountIntelFieldKey[],
  sourceFileName: string | null,
): Record<AccountIntelFieldKey, AccountIntelFieldProvenanceType> {
  const stored = storedFieldSources(row.metadata);
  const sourceInfo = sourceFromRow(row);
  const updatedAt = row.updatedAt.toISOString();
  const sourceFileId = row.extractedFromDocumentId;
  const confidence = Math.max(0, Math.min(1, row.confidenceBps / 10_000));

  let fallback: AccountIntelFieldProvenanceType;
  if (sourceInfo.source === 'manual') {
    fallback = {
      source: 'manual',
      label: 'Manual',
      hint: `Manually maintained account-intel record. Saved ${updatedAt.slice(0, 10)}.`,
      confidence,
      sourceFileId: null,
      sourceFileName: null,
      sourceExtractionId: null,
      updatedAt,
    };
  } else {
    const isDust = sourceInfo.source === 'derived:dust';
    const label = isDust ? 'Dust extraction' : 'Document extraction';
    fallback = {
      source: sourceInfo.source,
      label,
      hint: `${label} from ${sourceFileName ?? 'the source document'} with ${Math.round(
        confidence * 100,
      )}% confidence. Saved ${updatedAt.slice(0, 10)}.`,
      confidence,
      sourceFileId,
      sourceFileName,
      sourceExtractionId: sourceInfo.sourceExtractionId,
      updatedAt,
    };
  }

  return Object.fromEntries(
    fields.map((field) => [field, stored[field] ?? fallback]),
  ) as Record<AccountIntelFieldKey, AccountIntelFieldProvenanceType>;
}

export const accountIntelRoutes: FastifyPluginAsyncZod = async (server) => {
  async function ensureAccountVisible(input: {
    orgId: string;
    userId: string;
    accountId: string;
    companyId?: string | null;
  }) {
    const access = await canReadAccount({
      orgId: input.orgId,
      userId: input.userId,
      accountId: input.accountId,
      companyId: input.companyId,
      prismaClient: prisma,
    });
    if (!access.allowed) throw server.httpErrors.notFound('Account not found');
  }

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
      await ensureAccountVisible({
        orgId: req.auth.orgId,
        userId: req.auth.userId,
        accountId: req.params.accountId,
      });
      const [solutions, products, extractions] = await Promise.all([
        prisma.accountSolution.findMany({
          where: { orgId: req.auth.orgId, accountId: req.params.accountId, deletedAt: null },
          orderBy: { updatedAt: 'desc' },
          take: 500,
          // Narrow select — the response map below reads exactly these fields
          // (via buildIntelFieldSources' AccountIntelSourceRow contract).
          select: {
            id: true,
            accountId: true,
            name: true,
            description: true,
            category: true,
            status: true,
            extractedFromDocumentId: true,
            metadata: true,
            confidenceBps: true,
            createdAt: true,
            updatedAt: true,
          },
        }),
        prisma.accountProduct.findMany({
          where: { orgId: req.auth.orgId, accountId: req.params.accountId, deletedAt: null },
          orderBy: { updatedAt: 'desc' },
          take: 500,
          select: {
            id: true,
            accountId: true,
            name: true,
            description: true,
            category: true,
            priceRangeMicros: true,
            currency: true,
            status: true,
            extractedFromDocumentId: true,
            metadata: true,
            confidenceBps: true,
            createdAt: true,
            updatedAt: true,
          },
        }),
        prisma.documentExtraction.findMany({
          where: { orgId: req.auth.orgId, accountId: req.params.accountId, deletedAt: null },
          orderBy: { createdAt: 'desc' },
          take: 50,
          select: {
            id: true,
            documentId: true,
            accountId: true,
            status: true,
            extractedData: true,
            error: true,
            dustRunId: true,
            createdAt: true,
            updatedAt: true,
          },
        }),
      ]);
      const sourceDocumentIds = Array.from(
        new Set(
          [...solutions, ...products]
            .map((item) => item.extractedFromDocumentId)
            .filter((id): id is string => Boolean(id)),
        ),
      );
      const sourceFiles =
        sourceDocumentIds.length === 0
          ? []
          : await prisma.fileAttachment.findMany({
              where: { orgId: req.auth.orgId, id: { in: sourceDocumentIds }, deletedAt: null },
              select: { id: true, name: true },
              take: sourceDocumentIds.length,
            });
      const sourceFileNames = new Map(sourceFiles.map((file) => [file.id, file.name]));

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
          fieldSources: buildIntelFieldSources(
            s,
            SOLUTION_FIELD_KEYS,
            s.extractedFromDocumentId ? (sourceFileNames.get(s.extractedFromDocumentId) ?? null) : null,
          ),
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
          fieldSources: buildIntelFieldSources(
            p,
            PRODUCT_FIELD_KEYS,
            p.extractedFromDocumentId ? (sourceFileNames.get(p.extractedFromDocumentId) ?? null) : null,
          ),
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

  // GET /api/accounts/:accountId/news-signals — free, keyless news/intent proxy.
  // Recent public-web headlines about the account (Google News RSS, no API key).
  server.get(
    '/accounts/:accountId/news-signals',
    {
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
      schema: {
        params: z.object({ accountId: z.string().min(1).max(255) }),
        response: {
          200: z.object({
            source: z.literal('google-news'),
            fetchedAt: z.string().datetime(),
            sourceAttribution: SourceAttribution,
            items: z.array(
              z.object({
                title: z.string(),
                url: z.string(),
                source: z.string().nullable(),
                publishedAt: z.string().nullable(),
              }),
            ),
          }),
        },
      },
    },
    async (req) => {
      await ensureAccountVisible({
        orgId: req.auth.orgId,
        userId: req.auth.userId,
        accountId: req.params.accountId,
      });
      const items = await fetchCompanyNewsSignals(req.params.accountId);
      const fetchedAt = new Date().toISOString();
      return {
        source: 'google-news' as const,
        fetchedAt,
        sourceAttribution: {
          source: 'google_news_open_web',
          label: 'Google News',
          sourceUrl: 'https://news.google.com/',
          fetchedAt,
          confidence: 0.62,
          providerMetadata: {
            signalType: 'public_news',
            accountQuery: req.params.accountId,
          },
        },
        items,
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
      await ensureAccountVisible({
        orgId: req.auth.orgId,
        userId: req.auth.userId,
        accountId,
        companyId: file.companyId,
      });

      // Create extraction job record
      const extraction = await prisma.documentExtraction.create({
        data: {
          orgId: req.auth.orgId,
          documentId,
          accountId,
          companyId: file.companyId,
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
      await ensureAccountVisible({
        orgId: req.auth.orgId,
        userId: req.auth.userId,
        accountId: req.params.accountId,
      });
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
      await ensureAccountVisible({
        orgId: req.auth.orgId,
        userId: req.auth.userId,
        accountId: req.params.accountId,
      });
      await prisma.accountProduct.updateMany({
        where: { id: req.params.productId, orgId: req.auth.orgId, accountId: req.params.accountId },
        data: { deletedAt: new Date() },
      });
      return { success: true };
    },
  );
};
