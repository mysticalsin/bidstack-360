import { z } from 'zod';

export const AccountIntelFieldProvenanceSource = z.enum([
  'manual',
  'document',
  'derived:dust',
  'derived:deterministic',
]);
export type AccountIntelFieldProvenanceSource = z.infer<
  typeof AccountIntelFieldProvenanceSource
>;

export const AccountIntelFieldProvenance = z.object({
  source: AccountIntelFieldProvenanceSource,
  label: z.string().min(1),
  hint: z.string().min(1),
  confidence: z.number().min(0).max(1).nullable(),
  sourceFileId: z.string().guid().nullable(),
  sourceFileName: z.string().nullable(),
  sourceExtractionId: z.string().guid().nullable(),
  updatedAt: z.string().datetime(),
});
export type AccountIntelFieldProvenance = z.infer<typeof AccountIntelFieldProvenance>;

export const AccountSolution = z.object({
  id: z.string().guid(),
  accountId: z.string().min(1).max(255),
  name: z.string(),
  description: z.string().nullable(),
  category: z.string(),
  status: z.string(),
  extractedFromDocumentId: z.string().guid().nullable(),
  metadata: z.record(z.string(), z.unknown()),
  fieldSources: z.record(z.string(), AccountIntelFieldProvenance).default({}),
  confidenceBps: z.number().int(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type AccountSolution = z.infer<typeof AccountSolution>;

export const AccountProduct = z.object({
  id: z.string().guid(),
  accountId: z.string().min(1).max(255),
  name: z.string(),
  description: z.string().nullable(),
  category: z.string(),
  priceRangeMicros: z.number().int().nullable(),
  currency: z.string(),
  status: z.string(),
  extractedFromDocumentId: z.string().guid().nullable(),
  metadata: z.record(z.string(), z.unknown()),
  fieldSources: z.record(z.string(), AccountIntelFieldProvenance).default({}),
  confidenceBps: z.number().int(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type AccountProduct = z.infer<typeof AccountProduct>;

export const DocumentExtraction = z.object({
  id: z.string().guid(),
  documentId: z.string().guid(),
  accountId: z.string().min(1).max(255),
  status: z.enum(['pending', 'running', 'done', 'error']),
  extractedData: z.record(z.string(), z.unknown()),
  error: z.string().nullable(),
  dustRunId: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type DocumentExtraction = z.infer<typeof DocumentExtraction>;

export const ExtractDocumentRequest = z.object({
  prompt: z.string().min(1).max(4000).optional(),
});
export type ExtractDocumentRequest = z.infer<typeof ExtractDocumentRequest>;

export const AccountIntelSnapshot = z.object({
  solutions: z.array(AccountSolution),
  products: z.array(AccountProduct),
  extractions: z.array(DocumentExtraction),
});
export type AccountIntelSnapshot = z.infer<typeof AccountIntelSnapshot>;
