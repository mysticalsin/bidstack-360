/**
 * Shared Zod schemas for Wave 5 e-signature + document templates.
 *
 * WHY shared: routes, services, and frontend hooks all need consistent types.
 * The server uses these for input validation; the frontend uses them for
 * type-safe API response parsing.
 */

import { z } from 'zod';

// ─── Template kind ──────────────────────────────────────────────────────────

export const TemplateKind = z.enum(['QUOTE', 'MSA', 'SOW', 'NDA', 'PROPOSAL', 'CUSTOM']);
export type TemplateKind = z.infer<typeof TemplateKind>;

// ─── DocumentTemplate ───────────────────────────────────────────────────────

export const DocumentTemplate = z.object({
  id: z.string().uuid(),
  orgId: z.string().uuid(),
  name: z.string().min(1).max(200),
  kind: TemplateKind,
  description: z.string().max(500).nullable(),
  bodyHtml: z.string(),
  defaultVariables: z.record(z.string()),
  createdAt: z.string().datetime(),
});
export type DocumentTemplate = z.infer<typeof DocumentTemplate>;

export const DocumentTemplateCreate = z.object({
  name: z.string().min(1).max(200),
  kind: TemplateKind,
  description: z.string().max(500).optional(),
  bodyHtml: z.string().min(1),
  defaultVariables: z.record(z.string()).default({}),
});
export type DocumentTemplateCreate = z.infer<typeof DocumentTemplateCreate>;

export const DocumentTemplatePatch = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(500).nullable().optional(),
  bodyHtml: z.string().min(1).optional(),
  defaultVariables: z.record(z.string()).optional(),
});
export type DocumentTemplatePatch = z.infer<typeof DocumentTemplatePatch>;

// ─── DocumentTemplateVersion ─────────────────────────────────────────────────

export const DocumentTemplateVersion = z.object({
  id: z.string().uuid(),
  templateId: z.string().uuid(),
  version: z.number().int().positive(),
  bodyHtml: z.string(),
  createdAt: z.string().datetime(),
  createdBy: z.string().uuid(),
});
export type DocumentTemplateVersion = z.infer<typeof DocumentTemplateVersion>;

// ─── Signature status + events ────────────────────────────────────────────────

export const SignatureProvider = z.enum(['DOCUSIGN', 'INTERNAL']);
export type SignatureProvider = z.infer<typeof SignatureProvider>;

export const SignatureStatus = z.enum([
  'DRAFT',
  'SENT',
  'VIEWED',
  'SIGNED',
  'DECLINED',
  'VOIDED',
  'EXPIRED',
]);
export type SignatureStatus = z.infer<typeof SignatureStatus>;

export const SignatureEventType = z.enum([
  'SENT',
  'VIEWED',
  'SIGNED',
  'DECLINED',
  'DELIVERED',
  'VOIDED',
]);
export type SignatureEventType = z.infer<typeof SignatureEventType>;

/** A single recipient entry inside SignatureRequest.recipients */
export const SignatureRecipient = z.object({
  email: z.string().email().max(254),
  name: z.string().min(1).max(200),
  role: z.enum(['SIGNER', 'CC']).default('SIGNER'),
  signedAt: z.string().datetime().nullable().optional(),
});
export type SignatureRecipient = z.infer<typeof SignatureRecipient>;

export const SignatureRequest = z.object({
  id: z.string().uuid(),
  orgId: z.string().uuid(),
  documentId: z.string().uuid(),
  provider: SignatureProvider,
  providerRequestId: z.string().nullable(),
  status: SignatureStatus,
  recipients: z.array(SignatureRecipient),
  sentAt: z.string().datetime().nullable(),
  completedAt: z.string().datetime().nullable(),
  voidedAt: z.string().datetime().nullable(),
  voidReason: z.string().nullable(),
  completedDocumentS3Key: z.string().nullable(),
  createdAt: z.string().datetime(),
  // Enriched fields returned by detail endpoint
  templateName: z.string().optional(),
  events: z.array(z.lazy(() => SignatureEvent)).optional(),
});
export type SignatureRequest = z.infer<typeof SignatureRequest>;

export const SignatureRequestCreate = z.object({
  documentId: z.string().uuid(),
  templateId: z.string().uuid().optional(),
  recipients: z.array(SignatureRecipient).min(1).max(20),
  message: z.string().max(500).optional(),
  provider: SignatureProvider.default('DOCUSIGN'),
  variables: z.record(z.string()).optional(),
});
export type SignatureRequestCreate = z.infer<typeof SignatureRequestCreate>;

export const SignatureRequestVoid = z.object({
  reason: z.string().min(1).max(200),
});
export type SignatureRequestVoid = z.infer<typeof SignatureRequestVoid>;

// ─── SignatureEvent ───────────────────────────────────────────────────────────

export const SignatureEvent = z.object({
  id: z.string().uuid(),
  signatureRequestId: z.string().uuid(),
  type: SignatureEventType,
  recipientEmail: z.string().email().nullable(),
  occurredAt: z.string().datetime(),
  ipAddress: z.string().nullable(),
  userAgent: z.string().nullable(),
  payload: z.record(z.unknown()),
});
export type SignatureEvent = z.infer<typeof SignatureEvent>;

// ─── Public signing (INTERNAL provider) ──────────────────────────────────────

/** Shape returned by public GET /sign/:token */
export const PublicSignatureRequest = z.object({
  id: z.string().uuid(),
  status: SignatureStatus,
  templateName: z.string(),
  senderName: z.string(),
  message: z.string().nullable(),
  documentPreviewUrl: z.string().url().nullable(),
  recipientName: z.string(),
  recipientEmail: z.string().email(),
  expiresAt: z.string().datetime().nullable(),
});
export type PublicSignatureRequest = z.infer<typeof PublicSignatureRequest>;

/** Body submitted on the public /sign/:token page */
export const InternalSignSubmit = z.object({
  typedName: z.string().min(1).max(200),
  /** base64 data-URL of the canvas signature image */
  signatureDataUrl: z.string().startsWith('data:image/').max(500_000),
  acceptedTerms: z.literal(true, { errorMap: () => ({ message: 'Must accept terms' }) }),
});
export type InternalSignSubmit = z.infer<typeof InternalSignSubmit>;

// ─── List / pagination ────────────────────────────────────────────────────────

export const SignatureRequestFilter = z.object({
  status: SignatureStatus.optional(),
  recipientEmail: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(100).default(25),
});
export type SignatureRequestFilter = z.infer<typeof SignatureRequestFilter>;

export const SignatureRequestPage = z.object({
  items: z.array(SignatureRequest),
  nextCursor: z.string().nullable(),
  total: z.number().int(),
});
export type SignatureRequestPage = z.infer<typeof SignatureRequestPage>;

export const DocumentTemplatePage = z.object({
  items: z.array(DocumentTemplate),
  nextCursor: z.string().nullable(),
  total: z.number().int(),
});
export type DocumentTemplatePage = z.infer<typeof DocumentTemplatePage>;

// ─── Queue configs ────────────────────────────────────────────────────────────

export const SIGNATURE_POLL_QUEUE = {
  name: 'signature.poll',
  defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 30_000 } },
} as const;

export const SIGNATURE_REMINDER_QUEUE = {
  name: 'signature.reminder',
  defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 60_000 } },
} as const;
