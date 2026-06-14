// Contractual management per key/top account — MSAs, framework agreements, the
// countries each covers, global rebate terms (basis points), and the rate
// re-evaluation schedule. Demo feedback (Marc + Marie-Benoît). Read-tracked,
// pre-sales-owned; not a contract-authoring system.
import { z } from 'zod';

export const ContractKind = z.enum(['msa', 'framework', 'sow', 'nda', 'other']);
export type ContractKind = z.infer<typeof ContractKind>;

export const ContractRateSchedule = z.enum(['annual', 'biannual', 'quarterly', 'adhoc']);
export type ContractRateSchedule = z.infer<typeof ContractRateSchedule>;

export const ContractStatus = z.enum(['active', 'pending', 'expired', 'terminated']);
export type ContractStatus = z.infer<typeof ContractStatus>;

// ISO-3166 alpha-2, uppercased. Bounded list so one record can't carry a huge array.
const CountryCode = z.string().trim().length(2).toUpperCase();

export const RateCardUnit = z.enum(['day', 'hour', 'month', 'year', 'fixed']);
export type RateCardUnit = z.infer<typeof RateCardUnit>;

// One negotiated rate line: a role/profile and its rate (money in micros).
export const RateCardLine = z.object({
  role: z.string().min(1).max(120),
  rateMicros: z.number().int().min(0).max(1_000_000_000_000),
  unit: RateCardUnit,
  currency: z.string().length(3).nullable().optional(),
});
export type RateCardLine = z.infer<typeof RateCardLine>;

export const ContractAgreement = z.object({
  id: z.string().uuid(),
  accountKey: z.string().min(1),
  kind: ContractKind,
  reference: z.string().min(1).max(255),
  countries: z.array(CountryCode).max(100),
  globalRebateBps: z.number().int().min(0).max(100_000).nullable(),
  currency: z.string().length(3),
  rateCard: z.array(RateCardLine).max(200),
  effectiveDate: z.string().datetime().nullable(),
  expiryDate: z.string().datetime().nullable(),
  rateReviewSchedule: ContractRateSchedule,
  nextRateReviewAt: z.string().datetime().nullable(),
  status: ContractStatus,
  notes: z.string().max(4000).nullable(),
  // Hosted source document (uploaded MSA/rate-card) + its name for a view link.
  sourceFileId: z.string().uuid().nullable(),
  sourceFileName: z.string().nullable(),
  sourceExtractionId: z.string().uuid().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ContractAgreement = z.infer<typeof ContractAgreement>;

export const ContractAgreementCreate = z.object({
  accountKey: z.string().min(1).max(255),
  kind: ContractKind.default('msa'),
  reference: z.string().min(1).max(255),
  countries: z.array(CountryCode).max(100).default([]),
  globalRebateBps: z.number().int().min(0).max(100_000).nullable().optional(),
  currency: z.string().length(3).default('EUR'),
  rateCard: z.array(RateCardLine).max(200).default([]),
  effectiveDate: z.string().datetime().nullable().optional(),
  expiryDate: z.string().datetime().nullable().optional(),
  rateReviewSchedule: ContractRateSchedule.default('annual'),
  nextRateReviewAt: z.string().datetime().nullable().optional(),
  status: ContractStatus.default('active'),
  notes: z.string().max(4000).nullable().optional(),
  sourceFileId: z.string().uuid().nullable().optional(),
  sourceExtractionId: z.string().uuid().nullable().optional(),
});
export type ContractAgreementCreate = z.infer<typeof ContractAgreementCreate>;

export const ContractAgreementPatch = z
  .object({
    kind: ContractKind.optional(),
    reference: z.string().min(1).max(255).optional(),
    countries: z.array(CountryCode).max(100).optional(),
    globalRebateBps: z.number().int().min(0).max(100_000).nullable().optional(),
    currency: z.string().length(3).optional(),
    rateCard: z.array(RateCardLine).max(200).optional(),
    effectiveDate: z.string().datetime().nullable().optional(),
    expiryDate: z.string().datetime().nullable().optional(),
    rateReviewSchedule: ContractRateSchedule.optional(),
    nextRateReviewAt: z.string().datetime().nullable().optional(),
    status: ContractStatus.optional(),
    notes: z.string().max(4000).nullable().optional(),
    sourceFileId: z.string().uuid().nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'PATCH body must contain at least one field',
  });
export type ContractAgreementPatch = z.infer<typeof ContractAgreementPatch>;

export const ContractAgreementFilter = z.object({
  accountKey: z.string().max(255).optional(),
  status: ContractStatus.optional(),
});
export type ContractAgreementFilter = z.infer<typeof ContractAgreementFilter>;

export const ContractAgreementPage = z.object({
  items: z.array(ContractAgreement),
});
export type ContractAgreementPage = z.infer<typeof ContractAgreementPage>;

// ── Document extraction (OCR/LLM → reviewable prefill) ───────────────────────
// A best-effort extraction of a contract document. Every field is nullable —
// the user reviews/edits before it becomes a ContractAgreement. confidenceBps
// mirrors the repo convention (8500 = LLM, 5200 = deterministic regex), so the
// UI can flag low-confidence drafts and never auto-commit.
export const ContractExtractionDraft = z.object({
  reference: z.string().max(255).nullable(),
  kind: ContractKind.nullable(),
  countries: z.array(CountryCode).max(100),
  currency: z.string().length(3).nullable(),
  globalRebateBps: z.number().int().min(0).max(100_000).nullable(),
  effectiveDate: z.string().datetime().nullable(),
  expiryDate: z.string().datetime().nullable(),
  rateReviewSchedule: ContractRateSchedule.nullable(),
  rateCard: z.array(RateCardLine).max(200),
  confidenceBps: z.number().int().min(0).max(10_000),
  warnings: z.array(z.string()).max(50),
});
export type ContractExtractionDraft = z.infer<typeof ContractExtractionDraft>;

export const ContractExtractionStatus = z.enum(['pending', 'running', 'done', 'error']);
export type ContractExtractionStatus = z.infer<typeof ContractExtractionStatus>;

export const ContractExtractionResult = z.object({
  id: z.string().uuid(),
  fileId: z.string().uuid(),
  status: ContractExtractionStatus,
  draft: ContractExtractionDraft.nullable(),
  error: z.string().nullable(),
});
export type ContractExtractionResult = z.infer<typeof ContractExtractionResult>;
