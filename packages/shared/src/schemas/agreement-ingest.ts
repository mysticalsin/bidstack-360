// Agreement pull and inbound ingest (slice 13a). Every channel (SharePoint
// via Graph, DocuSign, REST, MCP) lands one AgreementIngestItem, which feeds
// the existing MSA intake pipeline: extract, cite, human review. Nothing here
// creates or edits an agreement without a person confirming the draft.
import { z } from 'zod';

import { MSA_ALLOWED_CONTENT_TYPES, MSA_MAX_BYTES } from './msa.js';

/** Inline base64 is capped below the 10 MiB request body limit; larger files use url. */
export const AGREEMENT_INGEST_INLINE_MAX_BYTES = 7 * 1024 * 1024;
export const AGREEMENT_INGEST_MAX_BYTES = MSA_MAX_BYTES;

export const AgreementIngestChannel = z.enum(['sharepoint', 'docusign', 'rest', 'mcp']);
export type AgreementIngestChannel = z.infer<typeof AgreementIngestChannel>;

export const AgreementIngestStatus = z.enum([
  'queued',
  'processing',
  'drafted',
  'versioned',
  'duplicate',
  'rejected',
  'failed',
]);
export type AgreementIngestStatus = z.infer<typeof AgreementIngestStatus>;

const ExternalSource = z
  .string()
  .min(1)
  .max(60)
  .regex(/^[a-z0-9][a-z0-9_.:-]*$/, 'lowercase letters, digits, and _ . : -');

const Base64 = z
  .string()
  .min(4)
  .max(Math.ceil((AGREEMENT_INGEST_INLINE_MAX_BYTES * 4) / 3) + 4)
  .regex(/^[A-Za-z0-9+/=\s]+$/, 'base64');

export const AgreementIngestMetadata = z
  .object({
    title: z.string().min(1).max(300).optional(),
    counterparty: z.string().min(1).max(300).optional(),
    companyId: z.string().uuid().optional(),
    companyName: z.string().min(1).max(200).optional(),
    signingEntity: z.string().min(1).max(80).optional(),
    signedAt: z.string().datetime({ offset: true }).optional(),
    effectiveDate: z.string().date().optional(),
    expiryDate: z.string().date().optional(),
    countries: z.array(z.string().regex(/^[A-Z]{2}$/)).max(60).optional(),
    sourceUrl: z.string().url().max(2000).optional(),
  })
  .strict();
export type AgreementIngestMetadata = z.infer<typeof AgreementIngestMetadata>;

export const AgreementIngestRequest = z
  .object({
    externalSource: ExternalSource,
    externalId: z.string().min(1).max(300),
    fileName: z.string().min(1).max(255),
    contentType: z.enum(MSA_ALLOWED_CONTENT_TYPES).optional(),
    file: z.union([
      z.object({ base64: Base64 }).strict(),
      z.object({ url: z.string().url().max(2000) }).strict(),
    ]),
    metadata: AgreementIngestMetadata.optional(),
  })
  .strict();
export type AgreementIngestRequest = z.infer<typeof AgreementIngestRequest>;

export const AgreementIngestItem = z.object({
  id: z.string().uuid(),
  channel: AgreementIngestChannel,
  externalSource: z.string(),
  externalId: z.string(),
  fileName: z.string(),
  status: AgreementIngestStatus,
  error: z.string().nullable(),
  duplicateOf: z.string().uuid().nullable(),
  intakeDraftId: z.string().uuid().nullable(),
  contractId: z.string().uuid().nullable(),
  contractFileVersionId: z.string().uuid().nullable(),
  createdAt: z.string(),
  processedAt: z.string().nullable(),
});
export type AgreementIngestItem = z.infer<typeof AgreementIngestItem>;

export const AgreementSourceKind = z.enum(['sharepoint', 'docusign']);
export type AgreementSourceKind = z.infer<typeof AgreementSourceKind>;

/** SharePoint / OneDrive library picked by an admin. Ids only, no secrets. */
export const SharePointSourceConfig = z
  .object({
    siteId: z.string().min(1).max(300),
    driveId: z.string().min(1).max(300),
    folderPath: z.string().min(1).max(500).optional(),
  })
  .strict();
export type SharePointSourceConfig = z.infer<typeof SharePointSourceConfig>;

/** DocuSign completed envelopes; at least one filter narrows the pull. */
export const DocuSignSourceConfig = z
  .object({
    templateId: z.string().min(1).max(100).optional(),
    folderId: z.string().min(1).max(100).optional(),
    keyword: z.string().min(2).max(100).optional(),
    fromDate: z.string().date().optional(),
  })
  .strict()
  .refine((c) => Boolean(c.templateId || c.folderId || c.keyword), {
    message: 'Set a template, folder or keyword filter',
  });
export type DocuSignSourceConfig = z.infer<typeof DocuSignSourceConfig>;

export const AgreementSyncResult = z.object({
  new: z.number().int().nonnegative(),
  updated: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
});
export type AgreementSyncResult = z.infer<typeof AgreementSyncResult>;

export const AgreementSyncRunState = z.enum(['queued', 'running', 'completed', 'failed']);

export const AgreementSyncRun = z.object({
  runId: z.string(),
  sourceId: z.string().uuid(),
  state: AgreementSyncRunState,
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  result: AgreementSyncResult.nullable(),
  reasons: z.array(z.string()),
});
export type AgreementSyncRun = z.infer<typeof AgreementSyncRun>;

export const AgreementSource = z.object({
  id: z.string().uuid(),
  kind: AgreementSourceKind,
  name: z.string(),
  enabled: z.boolean(),
  config: z.record(z.unknown()),
  configured: z.boolean(),
  lastSyncAt: z.string().nullable(),
  lastRun: AgreementSyncRun.nullable(),
});
export type AgreementSource = z.infer<typeof AgreementSource>;

export const AgreementSourceList = z.object({ items: z.array(AgreementSource) });

export const AgreementSourceCreate = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('sharepoint'), name: z.string().min(1).max(200), config: SharePointSourceConfig }).strict(),
  z.object({ kind: z.literal('docusign'), name: z.string().min(1).max(200), config: DocuSignSourceConfig }).strict(),
]);
export type AgreementSourceCreate = z.infer<typeof AgreementSourceCreate>;

export const AgreementSourceUpdate = z
  .object({
    name: z.string().min(1).max(200).optional(),
    enabled: z.boolean().optional(),
  })
  .strict();

/** PDF/DOCX by file name, for listing remote libraries before download. */
export function isAgreementFileName(name: string): boolean {
  return /\.(pdf|docx)$/i.test(name.trim());
}
