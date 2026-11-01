// MSA one-drop intake, signing entities, leverage flags and the
// "where we can bring value" panel. Deterministic first; LLM extract is a
// feature flag that defaults off.
import { z } from 'zod';

import { BUSINESS_LINES } from '../msa/business-lines.js';
import { MsaKind, MsaLiabilityCap, MsaStatus, MsaUploadUrlRequest, MsaUploadUrlResponse } from './msa.js';

export const MsaCitation = z.object({
  page: z.number().int().min(1).nullable(),
  clause: z.string().max(80).nullable(),
  excerpt: z.string().max(400),
});
export type MsaCitation = z.infer<typeof MsaCitation>;

export const MsaExtractedField = z.object({
  key: z.string(),
  value: z.unknown().nullable(),
  found: z.boolean(),
  confidenceBps: z.number().int().min(0).max(10_000),
  citation: MsaCitation.nullable(),
});
export type MsaExtractedField = z.infer<typeof MsaExtractedField>;

export const MsaParty = z.object({
  name: z.string(),
  role: z.enum(['client', 'ours', 'unknown']),
  address: z.string().nullable(),
  email: z.string().nullable(),
});
export type MsaParty = z.infer<typeof MsaParty>;

export const MsaExtractedFields = z.object({
  parties: MsaExtractedField,
  clientParty: MsaExtractedField,
  ourParty: MsaExtractedField,
  effectiveDate: MsaExtractedField,
  termMonths: MsaExtractedField,
  termText: MsaExtractedField,
  autoRenew: MsaExtractedField,
  renewalTerms: MsaExtractedField,
  expiryDate: MsaExtractedField,
  governingLaw: MsaExtractedField,
  liabilityCap: MsaExtractedField,
  paymentTerms: MsaExtractedField,
  noticePeriodDays: MsaExtractedField,
  ip: MsaExtractedField,
  confidentiality: MsaExtractedField,
  nonSolicit: MsaExtractedField,
  exclusivity: MsaExtractedField,
  insurance: MsaExtractedField,
  rateCard: MsaExtractedField,
  indexation: MsaExtractedField,
  scopeOfServices: MsaExtractedField,
  affiliatesClause: MsaExtractedField,
});
export type MsaExtractedFields = z.infer<typeof MsaExtractedFields>;

export const MsaAccountMatch = z.object({
  companyId: z.string().uuid(),
  name: z.string(),
  legalName: z.string().nullable(),
  domain: z.string().nullable(),
  scoreBps: z.number().int().min(0).max(10_000),
  reasons: z.array(z.string()),
});
export type MsaAccountMatch = z.infer<typeof MsaAccountMatch>;

export const BrandFamily = z.enum(['mantu', 'amaris', 'other']);
export type BrandFamily = z.infer<typeof BrandFamily>;

export const VerificationStatus = z.enum(['verified', 'unverified']);
export type VerificationStatus = z.infer<typeof VerificationStatus>;

export const BusinessLine = z.enum(BUSINESS_LINES);
export type BusinessLine = z.infer<typeof BusinessLine>;

export const SigningEntityRef = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  name: z.string(),
  legalName: z.string().nullable(),
  brandFamily: BrandFamily,
  aliases: z.array(z.string()),
  businessLines: z.array(z.string()),
  sourceUrl: z.string(),
  verificationStatus: VerificationStatus,
});
export type SigningEntityRef = z.infer<typeof SigningEntityRef>;

export const MsaSigningEntityMatch = z.object({
  entityId: z.string().uuid().nullable(),
  slug: z.string(),
  name: z.string(),
  scoreBps: z.number().int().min(0).max(10_000),
  alias: z.string().nullable(),
  reasons: z.array(z.string()),
});
export type MsaSigningEntityMatch = z.infer<typeof MsaSigningEntityMatch>;

export const MsaIntakeStatus = z.enum(['pending_review', 'confirmed', 'discarded', 'needs_ocr']);
export type MsaIntakeStatus = z.infer<typeof MsaIntakeStatus>;

export const MsaIntakeDraft = z.object({
  id: z.string().uuid(),
  status: MsaIntakeStatus,
  fileName: z.string(),
  contentType: z.string(),
  bytes: z.number().int(),
  sha256: z.string().length(64),
  needsOcr: z.boolean(),
  usedLlm: z.boolean(),
  pageCount: z.number().int().nullable(),
  extractedFields: MsaExtractedFields,
  accountMatches: z.array(MsaAccountMatch),
  signingEntityMatches: z.array(MsaSigningEntityMatch),
  warnings: z.array(z.string()),
  confirmedContractId: z.string().uuid().nullable(),
  createdAt: z.string().datetime(),
});
export type MsaIntakeDraft = z.infer<typeof MsaIntakeDraft>;

export const MsaIntakeUploadUrlRequest = MsaUploadUrlRequest;
export type MsaIntakeUploadUrlRequest = z.infer<typeof MsaIntakeUploadUrlRequest>;

export const MsaIntakeUploadUrlResponse = MsaUploadUrlResponse.extend({
  draftId: z.string().uuid(),
});
export type MsaIntakeUploadUrlResponse = z.infer<typeof MsaIntakeUploadUrlResponse>;

export const MsaIntakeFinalize = MsaUploadUrlRequest.extend({
  storageKey: z.string().min(1).max(500),
  draftId: z.string().uuid(),
});
export type MsaIntakeFinalize = z.infer<typeof MsaIntakeFinalize>;

export const MsaIntakeConfirm = z.object({
  companyId: z.string().uuid().nullable().optional(),
  createCompany: z
    .object({
      name: z.string().trim().min(1).max(200),
      domain: z.string().trim().max(200).nullable().optional(),
    })
    .nullable()
    .optional(),
  signingEntityId: z.string().uuid().nullable().optional(),
  status: MsaStatus.default('active'),
  kind: MsaKind.default('msa'),
  title: z.string().trim().min(1).max(300).optional(),
  fieldOverrides: z
    .object({
      counterparty: z.string().trim().max(300).nullable().optional(),
      effectiveDate: z.string().datetime().nullable().optional(),
      expiryDate: z.string().datetime().nullable().optional(),
      autoRenew: z.boolean().optional(),
      noticePeriodDays: z.number().int().min(0).max(730).nullable().optional(),
      governingLaw: z.string().trim().max(200).nullable().optional(),
      liabilityCap: MsaLiabilityCap.nullable().optional(),
      paymentTerms: z.string().trim().max(500).nullable().optional(),
      termMonths: z.number().int().min(0).max(600).nullable().optional(),
      renewalTerms: z.string().trim().max(500).nullable().optional(),
      ipClause: z.string().trim().max(4000).nullable().optional(),
      confidentiality: z.string().trim().max(4000).nullable().optional(),
      nonSolicit: z.string().trim().max(4000).nullable().optional(),
      exclusivity: z.string().trim().max(4000).nullable().optional(),
      insurance: z.string().trim().max(4000).nullable().optional(),
      indexation: z.string().trim().max(500).nullable().optional(),
      scopeOfServices: z.string().trim().max(4000).nullable().optional(),
      affiliatesClause: z.string().trim().max(4000).nullable().optional(),
    })
    .optional(),
});
export type MsaIntakeConfirm = z.infer<typeof MsaIntakeConfirm>;

export const MsaIntakeConfirmResponse = z.object({
  contractId: z.string().uuid(),
  companyId: z.string().uuid(),
  createdCompany: z.boolean(),
});
export type MsaIntakeConfirmResponse = z.infer<typeof MsaIntakeConfirmResponse>;

export const SigningEntity = SigningEntityRef.extend({
  notes: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type SigningEntity = z.infer<typeof SigningEntity>;

export const SigningEntityListResponse = z.object({ items: z.array(SigningEntity) });
export type SigningEntityListResponse = z.infer<typeof SigningEntityListResponse>;

export const SigningEntityWrite = z.object({
  slug: z
    .string()
    .trim()
    .min(2)
    .max(80)
    .regex(/^[a-z0-9-]+$/),
  name: z.string().trim().min(1).max(200),
  legalName: z.string().trim().max(300).nullable().optional(),
  brandFamily: BrandFamily,
  aliases: z.array(z.string().trim().min(1).max(200)).max(30).default([]),
  businessLines: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  sourceUrl: z.string().url().max(500),
  verificationStatus: VerificationStatus.default('unverified'),
  notes: z.string().trim().max(1000).nullable().optional(),
});
export type SigningEntityWrite = z.infer<typeof SigningEntityWrite>;

export const MsaLeverageFlag = z.object({
  companyId: z.string().uuid(),
  companyName: z.string(),
  msaId: z.string().uuid(),
  msaTitle: z.string(),
  signingEntity: SigningEntityRef.pick({
    id: true,
    slug: true,
    name: true,
    brandFamily: true,
    businessLines: true,
    verificationStatus: true,
  }),
  coveredLines: z.array(z.string()),
  missingLines: z.array(z.string()),
  headline: z.string(),
  scopeAllowsOtherServices: z.boolean().nullable(),
  scopeNeedsAmendment: z.boolean(),
  scopeCitation: MsaCitation.nullable(),
});
export type MsaLeverageFlag = z.infer<typeof MsaLeverageFlag>;

export const MsaLeverageListResponse = z.object({
  items: z.array(MsaLeverageFlag),
  hemaPharmaCount: z.number().int(),
});
export type MsaLeverageListResponse = z.infer<typeof MsaLeverageListResponse>;

export const MsaLeverageSummary = z.object({
  underLeveragedAccounts: z.number().int(),
  hemaPharmaAccounts: z.number().int(),
});
export type MsaLeverageSummary = z.infer<typeof MsaLeverageSummary>;

export const MsaValueItemKind = z.enum(['uncovered_service', 'renewal_window', 'weak_clause']);
export type MsaValueItemKind = z.infer<typeof MsaValueItemKind>;

export const MsaApproachContact = z.object({
  name: z.string(),
  title: z.string().nullable(),
  email: z.string().nullable(),
});
export type MsaApproachContact = z.infer<typeof MsaApproachContact>;

export const MsaValueItem = z.object({
  id: z.string(),
  kind: MsaValueItemKind,
  title: z.string(),
  detail: z.string(),
  citation: MsaCitation.nullable(),
  absence: z.boolean(),
  approach: MsaApproachContact.nullable(),
});
export type MsaValueItem = z.infer<typeof MsaValueItem>;

export const MsaValuePanel = z.object({
  msaId: z.string().uuid(),
  items: z.array(MsaValueItem),
});
export type MsaValuePanel = z.infer<typeof MsaValuePanel>;

export const LOW_LIABILITY_CAP_UNITS = 1_000_000;
export const LONG_PAYMENT_DAYS = 60;
