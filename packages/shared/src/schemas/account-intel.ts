import { z } from 'zod';

export const AccountSolution = z.object({
  id: z.string().uuid(),
  accountId: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  category: z.string(),
  status: z.string(),
  extractedFromDocumentId: z.string().uuid().nullable(),
  metadata: z.record(z.unknown()),
  confidenceBps: z.number().int(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type AccountSolution = z.infer<typeof AccountSolution>;

export const AccountProduct = z.object({
  id: z.string().uuid(),
  accountId: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  category: z.string(),
  priceRangeMicros: z.number().int().nullable(),
  currency: z.string(),
  status: z.string(),
  extractedFromDocumentId: z.string().uuid().nullable(),
  metadata: z.record(z.unknown()),
  confidenceBps: z.number().int(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type AccountProduct = z.infer<typeof AccountProduct>;

export const DocumentExtraction = z.object({
  id: z.string().uuid(),
  documentId: z.string().uuid(),
  accountId: z.string(),
  status: z.enum(['pending', 'running', 'done', 'error']),
  extractedData: z.record(z.unknown()),
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
