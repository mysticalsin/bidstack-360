// Contractual management per account — MSAs / framework agreements, countries
// covered, global rebate (bps), rate re-evaluation schedule. Pre-sales-owned,
// org-scoped, audited. Mirrors the cross-sell action log route pattern.
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { prisma } from '@bidstack/db';
import {
  ContractAgreement,
  ContractAgreementCreate,
  ContractExtractionApproval,
  ContractAgreementFilter,
  ContractAgreementPage,
  ContractAgreementPatch,
  RateCardLine,
  ContractFieldProvenance,
  ContractExtractionDraft,
  ContractExtractionResult,
  type ContractFieldProvenance as ContractFieldProvenanceValue,
  type ContractExtractionStatus,
} from '@bidstack/shared';

import { normalizeName } from '../services/crm/dashboard.utils.js';
import { enqueueDocumentExtract } from '../queues/document-extract.js';
import { canReadAccount } from '../lib/account-access.js';

interface DbRow {
  id: string;
  accountKey: string;
  kind: string;
  reference: string;
  countries: string[];
  globalRebateBps: number | null;
  currency: string;
  rateCard: unknown;
  effectiveDate: Date | null;
  expiryDate: Date | null;
  rateReviewSchedule: string;
  nextRateReviewAt: Date | null;
  status: string;
  notes: string | null;
  sourceFileId: string | null;
  sourceExtractionId: string | null;
  sourceFile: { name: string } | null;
  createdAt: Date;
  updatedAt: Date;
}

interface ExtractionRow {
  id: string;
  documentId: string;
  accountId: string;
  status: string;
  extractedData: unknown;
  error: string | null;
  updatedAt: Date;
}

interface ExtractionSourceRow {
  id: string;
  extractedData: unknown;
  updatedAt: Date;
}

interface SourceFileRow {
  id: string;
  accountId: string;
  companyId: string | null;
  name: string;
  storageKey?: string;
  contentType?: string;
}

const SELECT = {
  id: true,
  accountKey: true,
  kind: true,
  reference: true,
  countries: true,
  globalRebateBps: true,
  currency: true,
  rateCard: true,
  effectiveDate: true,
  expiryDate: true,
  rateReviewSchedule: true,
  nextRateReviewAt: true,
  status: true,
  notes: true,
  sourceFileId: true,
  sourceExtractionId: true,
  sourceFile: { select: { name: true } },
  createdAt: true,
  updatedAt: true,
} as const;

const CONTRACT_FIELD_KEYS = [
  'kind',
  'reference',
  'countries',
  'globalRebateBps',
  'currency',
  'rateCard',
  'effectiveDate',
  'expiryDate',
  'rateReviewSchedule',
  'nextRateReviewAt',
  'status',
  'notes',
] as const;

type ContractFieldKey = (typeof CONTRACT_FIELD_KEYS)[number];

function buildFieldSources(
  row: DbRow,
  extraction?: ExtractionSourceRow | null,
): Record<ContractFieldKey, ContractFieldProvenanceValue> {
  const extractedDraft = extraction
    ? (ContractExtractionDraft.safeParse(extraction.extractedData).data ?? null)
    : null;
  const sourceFileName = row.sourceFile?.name ?? null;
  let provenance: ContractFieldProvenanceValue;

  const savedOn = isoOrNull(row.updatedAt) ?? new Date(0).toISOString();
  const savedDay = savedOn.slice(0, 10);
  if (row.sourceExtractionId && extractedDraft) {
    const isLlm = extractionSource(extractedDraft) === 'llm';
    provenance = {
      source: isLlm ? 'derived:llm' : 'derived:deterministic',
      label: isLlm ? 'AI reviewed' : 'Rules reviewed',
      hint: `Human-reviewed ${isLlm ? 'AI' : 'rules'} extraction from ${sourceFileName ?? 'the source document'}. Saved ${savedDay}.`,
      confidence:
        extractedDraft.confidenceBps == null ? null : extractedDraft.confidenceBps / 10_000,
      sourceFileId: uuidOrNull(row.sourceFileId),
      sourceFileName,
      sourceExtractionId: uuidOrNull(row.sourceExtractionId),
      updatedAt: savedOn,
    };
  } else if (row.sourceFileId) {
    provenance = {
      source: 'document',
      label: 'Document',
      hint: `Linked to source document ${sourceFileName ?? row.sourceFileId}. Saved ${savedDay}.`,
      confidence: null,
      sourceFileId: uuidOrNull(row.sourceFileId),
      sourceFileName,
      sourceExtractionId: uuidOrNull(row.sourceExtractionId),
      updatedAt: savedOn,
    };
  } else {
    provenance = {
      source: 'manual',
      label: 'Manual',
      hint: `Manually maintained in Polo PreSales CRM. Saved ${savedDay}.`,
      confidence: 1,
      sourceFileId: null,
      sourceFileName: null,
      sourceExtractionId: null,
      updatedAt: savedOn,
    };
  }
  const parsedProvenance = ContractFieldProvenance.safeParse(provenance);
  if (!parsedProvenance.success) {
    provenance = {
      source: 'manual',
      label: 'Manual',
      hint: 'Manually maintained in Polo PreSales CRM.',
      confidence: 1,
      sourceFileId: null,
      sourceFileName: null,
      sourceExtractionId: null,
      updatedAt: savedOn,
    };
  } else {
    provenance = parsedProvenance.data;
  }

  return Object.fromEntries(CONTRACT_FIELD_KEYS.map((key) => [key, provenance])) as Record<
    ContractFieldKey,
    ContractFieldProvenanceValue
  >;
}

const CONTRACT_KINDS = new Set(['msa', 'framework', 'sow', 'nda', 'other']);
const CONTRACT_STATUSES = new Set(['active', 'pending', 'expired', 'terminated']);
const RATE_SCHEDULES = new Set(['annual', 'biannual', 'quarterly', 'adhoc']);

function enumOr<T extends string>(value: string, allowed: Set<string>, fallback: T): T {
  return allowed.has(value) ? (value as T) : fallback;
}

function isoOrNull(value: Date | null): string | null {
  if (!value || Number.isNaN(value.getTime())) return null;
  try {
    const iso = value.toISOString();
    return z.string().datetime().safeParse(iso).success ? iso : null;
  } catch {
    return null;
  }
}

const MAX_RATE_MICROS = 1_000_000_000_000;

function integerRateMicros(value: unknown): number | null {
  if (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= MAX_RATE_MICROS
  ) {
    return value;
  }
  if (typeof value === 'bigint' && value >= 0n && value <= BigInt(MAX_RATE_MICROS))
    return Number(value);
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    try {
      const micros = BigInt(value);
      if (micros <= BigInt(MAX_RATE_MICROS)) return Number(micros);
    } catch {
      return null;
    }
  }
  return null;
}

function coerceRateCard(value: unknown): z.infer<typeof RateCardLine>[] {
  if (!Array.isArray(value)) return [];
  const lines: z.infer<typeof RateCardLine>[] = [];
  for (const entry of value) {
    const direct = RateCardLine.safeParse(entry);
    if (direct.success) {
      lines.push(direct.data);
    } else if (entry && typeof entry === 'object') {
      const rateMicros = integerRateMicros((entry as { rateMicros?: unknown }).rateMicros);
      if (rateMicros != null) {
        const recovered = RateCardLine.safeParse({ ...entry, rateMicros });
        if (recovered.success) lines.push(recovered.data);
      }
    }
    if (lines.length === 200) break;
  }
  return lines;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function uuidOrNull(value: string | null): string | null {
  return value && UUID_RE.test(value) ? value : null;
}

function countryCodes(values: readonly string[]): string[] {
  return values
    .map((code) => code.trim().toUpperCase())
    .filter((code) => /^[A-Z]{2}$/.test(code))
    .slice(0, 100);
}

function serialize(
  row: DbRow,
  extraction?: ExtractionSourceRow | null,
): z.infer<typeof ContractAgreement> {
  const reference = row.reference.trim().slice(0, 255);
  const currency = /^[A-Za-z]{3}$/.test(row.currency) ? row.currency.toUpperCase() : 'XXX';
  const rebate = row.globalRebateBps;
  return {
    id: row.id,
    accountKey: row.accountKey,
    kind: enumOr(row.kind, CONTRACT_KINDS, 'other'),
    reference: reference.length > 0 ? reference : 'Recorded agreement',
    // A full country name is not an ISO code. Dropping it keeps the list readable.
    countries: countryCodes(row.countries),
    globalRebateBps:
      typeof rebate === 'number' && Number.isInteger(rebate) && rebate >= 0 && rebate <= 100_000
        ? rebate
        : null,
    currency,
    // The Json column is validated back into RateCardLine[]; a malformed legacy
    // value degrades to an empty card rather than failing the read.
    rateCard: coerceRateCard(row.rateCard),
    effectiveDate: isoOrNull(row.effectiveDate),
    expiryDate: isoOrNull(row.expiryDate),
    rateReviewSchedule: enumOr(row.rateReviewSchedule, RATE_SCHEDULES, 'adhoc'),
    nextRateReviewAt: isoOrNull(row.nextRateReviewAt),
    status: enumOr(row.status, CONTRACT_STATUSES, 'pending'),
    notes: row.notes == null ? null : row.notes.slice(0, 4000),
    sourceFileId: uuidOrNull(row.sourceFileId),
    sourceFileName: row.sourceFile?.name ?? null,
    sourceExtractionId: uuidOrNull(row.sourceExtractionId),
    fieldSources: buildFieldSources(row, extraction),
    createdAt: isoOrNull(row.createdAt) ?? new Date(0).toISOString(),
    updatedAt: isoOrNull(row.updatedAt) ?? new Date(0).toISOString(),
  };
}

function readAgreement(
  row: DbRow,
  extraction?: ExtractionSourceRow | null,
): { ok: true; value: z.infer<typeof ContractAgreement> } | { ok: false } {
  try {
    const parsed = ContractAgreement.safeParse(serialize(row, extraction));
    return parsed.success ? { ok: true, value: parsed.data } : { ok: false };
  } catch {
    return { ok: false };
  }
}

const IdParam = z.object({ id: z.string().uuid() });
const toDate = (v: string | null | undefined): Date | null | undefined =>
  v === undefined ? undefined : v === null ? null : new Date(v);

function mapExtractionStatus(status: string): ContractExtractionStatus {
  if (status === 'done') return 'done';
  if (status === 'error' || status === 'failed') return 'error';
  if (status === 'pending') return 'pending';
  return 'running';
}

function extractionSource(
  draft: z.infer<typeof ContractExtractionDraft> | null,
): z.infer<typeof ContractExtractionResult>['source'] {
  if (!draft) return 'unknown';
  if (draft.method === 'llm' || draft.method === 'deterministic') return draft.method;
  if (draft.confidenceBps == null) return 'unknown';
  return draft.confidenceBps >= 8000 ? 'llm' : 'deterministic';
}

function serializeExtraction(
  row: ExtractionRow,
  file: SourceFileRow | null,
  approvedAgreementId: string | null,
): z.infer<typeof ContractExtractionResult> {
  const status = mapExtractionStatus(row.status);
  const draft =
    status === 'done' ? (ContractExtractionDraft.safeParse(row.extractedData).data ?? null) : null;
  return {
    id: row.id,
    fileId: row.documentId,
    sourceFileId: row.documentId,
    sourceFileName: file?.name ?? null,
    accountKey: row.accountId || null,
    status,
    reviewStatus: approvedAgreementId ? 'approved' : 'needs_review',
    approvedAgreementId,
    draft,
    confidenceBps: draft?.confidenceBps ?? null,
    warnings: draft?.warnings ?? [],
    source: extractionSource(draft),
    extractedAt: status === 'done' ? row.updatedAt.toISOString() : null,
    error: row.error,
  };
}

export const contractAgreementRoutes: FastifyPluginAsyncZod = async (server) => {
  async function loadExtractionSourceMap(
    orgId: string,
    rows: DbRow[],
  ): Promise<Map<string, ExtractionSourceRow>> {
    const ids = Array.from(
      new Set(rows.map((row) => row.sourceExtractionId).filter((id): id is string => Boolean(id))),
    );
    if (ids.length === 0) return new Map();
    const extractions = await prisma.documentExtraction.findMany({
      where: { orgId, id: { in: ids }, deletedAt: null },
      select: { id: true, extractedData: true, updatedAt: true },
    });
    return new Map(extractions.map((row) => [row.id, row]));
  }

  async function ensureAccountVisible(input: {
    orgId: string;
    userId: string;
    accountKey: string;
    companyId?: string | null;
  }) {
    const access = await canReadAccount({
      orgId: input.orgId,
      userId: input.userId,
      accountId: input.accountKey,
      accountName: input.accountKey,
      companyId: input.companyId,
      prismaClient: prisma,
    });
    if (!access.allowed) throw server.httpErrors.notFound('Account not found');
  }

  async function loadSourceFileOrThrow(input: {
    orgId: string;
    userId: string;
    fileId: string;
    expectedAccountKey?: string;
  }): Promise<SourceFileRow> {
    const file = await prisma.fileAttachment.findFirst({
      where: { id: input.fileId, orgId: input.orgId, deletedAt: null },
      select: {
        id: true,
        accountId: true,
        companyId: true,
        name: true,
        storageKey: true,
        contentType: true,
      },
    });
    if (!file) throw server.httpErrors.badRequest('Source document not found in this org');
    if (
      input.expectedAccountKey &&
      normalizeName(file.accountId) !== normalizeName(input.expectedAccountKey)
    ) {
      throw server.httpErrors.badRequest('Source document belongs to a different account');
    }
    await ensureAccountVisible({
      orgId: input.orgId,
      userId: input.userId,
      accountKey: file.accountId,
      companyId: file.companyId,
    });
    return file;
  }

  async function loadCompletedExtractionOrThrow(input: {
    orgId: string;
    userId: string;
    extractionId: string;
    expectedAccountKey?: string;
  }): Promise<{
    row: ExtractionRow;
    file: SourceFileRow;
    draft: z.infer<typeof ContractExtractionDraft>;
  }> {
    const row = await prisma.documentExtraction.findFirst({
      where: { id: input.extractionId, orgId: input.orgId, deletedAt: null },
      select: {
        id: true,
        documentId: true,
        accountId: true,
        status: true,
        extractedData: true,
        error: true,
        updatedAt: true,
      },
    });
    if (!row) throw server.httpErrors.badRequest('Source extraction not found in this org');
    if (
      input.expectedAccountKey &&
      normalizeName(row.accountId) !== normalizeName(input.expectedAccountKey)
    ) {
      throw server.httpErrors.badRequest('Source extraction belongs to a different account');
    }
    if (mapExtractionStatus(row.status) !== 'done') {
      throw server.httpErrors.conflict('Source extraction is not ready for approval');
    }
    const draft = ContractExtractionDraft.safeParse(row.extractedData);
    if (!draft.success) {
      throw server.httpErrors.conflict('Source extraction does not contain a valid contract draft');
    }
    const file = await loadSourceFileOrThrow({
      orgId: input.orgId,
      userId: input.userId,
      fileId: row.documentId,
      expectedAccountKey: input.expectedAccountKey ?? row.accountId,
    });
    return { row, file, draft: draft.data };
  }

  server.get(
    '/contract-agreements',
    {
      preHandler: [server.requirePermission('accounts:read')],
      schema: { querystring: ContractAgreementFilter, response: { 200: ContractAgreementPage } },
    },
    async (req) => {
      const accountKey = req.query.accountKey ? normalizeName(req.query.accountKey) : null;
      if (!accountKey) throw server.httpErrors.badRequest('accountKey is required');
      await ensureAccountVisible({
        orgId: req.auth.orgId,
        userId: req.auth.userId,
        accountKey,
      });
      const rows = await prisma.contractAgreement.findMany({
        where: {
          orgId: req.auth.orgId,
          deletedAt: null,
          accountKey,
          ...(req.query.status ? { status: req.query.status } : {}),
        },
        select: SELECT,
        orderBy: [{ status: 'asc' }, { effectiveDate: 'desc' }],
        take: 200,
      });
      const extractionSources = await loadExtractionSourceMap(req.auth.orgId, rows);
      const items = [];
      for (const row of rows) {
        const read = readAgreement(
          row,
          row.sourceExtractionId ? extractionSources.get(row.sourceExtractionId) : null,
        );
        if (read.ok) items.push(read.value);
        else
          req.log.warn(
            { agreementId: row.id },
            'omitted a contract agreement that failed response validation',
          );
      }
      return { items };
    },
  );

  server.post(
    '/contract-agreements',
    {
      preHandler: [server.requirePermission('accounts:write')],
      schema: { body: ContractAgreementCreate, response: { 201: ContractAgreement } },
    },
    async (req, reply) => {
      const accountKey = normalizeName(req.body.accountKey);
      await ensureAccountVisible({
        orgId: req.auth.orgId,
        userId: req.auth.userId,
        accountKey,
      });

      let sourceFileId = req.body.sourceFileId ?? null;
      let sourceExtraction: ExtractionSourceRow | null = null;
      if (req.body.sourceExtractionId) {
        const { row } = await loadCompletedExtractionOrThrow({
          orgId: req.auth.orgId,
          userId: req.auth.userId,
          extractionId: req.body.sourceExtractionId,
          expectedAccountKey: accountKey,
        });
        if (sourceFileId && sourceFileId !== row.documentId) {
          throw server.httpErrors.badRequest(
            'Source document does not match the completed extraction',
          );
        }
        sourceFileId = row.documentId;
        sourceExtraction = row;
      } else if (sourceFileId) {
        await loadSourceFileOrThrow({
          orgId: req.auth.orgId,
          userId: req.auth.userId,
          fileId: sourceFileId,
          expectedAccountKey: accountKey,
        });
      }
      const created = await prisma.contractAgreement.create({
        data: {
          orgId: req.auth.orgId,
          accountKey,
          sourceFileId,
          sourceExtractionId: req.body.sourceExtractionId ?? null,
          kind: req.body.kind,
          reference: req.body.reference,
          countries: req.body.countries,
          globalRebateBps: req.body.globalRebateBps ?? null,
          currency: req.body.currency,
          rateCard: req.body.rateCard,
          effectiveDate: toDate(req.body.effectiveDate) ?? null,
          expiryDate: toDate(req.body.expiryDate) ?? null,
          rateReviewSchedule: req.body.rateReviewSchedule,
          nextRateReviewAt: toDate(req.body.nextRateReviewAt) ?? null,
          status: req.body.status,
          notes: req.body.notes ?? null,
          createdById: req.auth.userId,
        },
        select: SELECT,
      });
      await prisma.auditLog.create({
        data: {
          orgId: req.auth.orgId,
          userId: req.auth.userId,
          action: 'contract_agreement.create',
          targetType: 'contract_agreement',
          targetId: created.id,
          diff: {
            accountKey: created.accountKey,
            kind: created.kind,
            reference: created.reference,
          },
        },
      });
      const read = readAgreement(created, sourceExtraction);
      if (!read.ok) {
        req.log.error({ agreementId: created.id }, 'saved agreement could not be serialized');
        throw server.httpErrors.internalServerError(
          'Saved the agreement, but the response could not be read',
        );
      }
      return reply.code(201).send(read.value);
    },
  );

  server.patch(
    '/contract-agreements/:id',
    {
      preHandler: [server.requirePermission('accounts:write')],
      schema: {
        params: IdParam,
        body: ContractAgreementPatch,
        response: { 200: ContractAgreement },
      },
    },
    async (req) => {
      const existing = await prisma.contractAgreement.findFirst({
        where: { id: req.params.id, orgId: req.auth.orgId, deletedAt: null },
        select: { id: true, accountKey: true },
      });
      if (!existing) throw server.httpErrors.notFound('Contract agreement not found');
      await ensureAccountVisible({
        orgId: req.auth.orgId,
        userId: req.auth.userId,
        accountKey: existing.accountKey,
      });
      const b = req.body;
      if (b.sourceFileId) {
        await loadSourceFileOrThrow({
          orgId: req.auth.orgId,
          userId: req.auth.userId,
          fileId: b.sourceFileId,
          expectedAccountKey: existing.accountKey,
        });
      }
      await prisma.contractAgreement.updateMany({
        where: { id: existing.id, orgId: req.auth.orgId, deletedAt: null },
        data: {
          ...(b.kind !== undefined ? { kind: b.kind } : {}),
          ...(b.reference !== undefined ? { reference: b.reference } : {}),
          ...(b.countries !== undefined ? { countries: b.countries } : {}),
          ...(b.globalRebateBps !== undefined ? { globalRebateBps: b.globalRebateBps } : {}),
          ...(b.currency !== undefined ? { currency: b.currency } : {}),
          ...(b.rateCard !== undefined ? { rateCard: b.rateCard } : {}),
          ...(b.effectiveDate !== undefined ? { effectiveDate: toDate(b.effectiveDate) } : {}),
          ...(b.expiryDate !== undefined ? { expiryDate: toDate(b.expiryDate) } : {}),
          ...(b.rateReviewSchedule !== undefined
            ? { rateReviewSchedule: b.rateReviewSchedule }
            : {}),
          ...(b.nextRateReviewAt !== undefined
            ? { nextRateReviewAt: toDate(b.nextRateReviewAt) }
            : {}),
          ...(b.status !== undefined ? { status: b.status } : {}),
          ...(b.notes !== undefined ? { notes: b.notes } : {}),
          ...(b.sourceFileId !== undefined ? { sourceFileId: b.sourceFileId } : {}),
        },
      });
      const updated = await prisma.contractAgreement.findFirstOrThrow({
        where: { id: existing.id, orgId: req.auth.orgId },
        select: SELECT,
      });
      const extractionSources = await loadExtractionSourceMap(req.auth.orgId, [updated]);
      await prisma.auditLog.create({
        data: {
          orgId: req.auth.orgId,
          userId: req.auth.userId,
          action: 'contract_agreement.update',
          targetType: 'contract_agreement',
          targetId: updated.id,
          diff: req.body as object,
        },
      });
      const read = readAgreement(
        updated,
        updated.sourceExtractionId ? extractionSources.get(updated.sourceExtractionId) : null,
      );
      if (!read.ok) {
        req.log.error({ agreementId: updated.id }, 'updated agreement could not be serialized');
        throw server.httpErrors.internalServerError(
          'Saved the agreement, but the response could not be read',
        );
      }
      return read.value;
    },
  );

  server.delete(
    '/contract-agreements/:id',
    {
      preHandler: [server.requirePermission('accounts:write')],
      schema: { params: IdParam, response: { 204: z.null() } },
    },
    async (req, reply) => {
      const existing = await prisma.contractAgreement.findFirst({
        where: { id: req.params.id, orgId: req.auth.orgId, deletedAt: null },
        select: { id: true, accountKey: true },
      });
      if (!existing) throw server.httpErrors.notFound('Contract agreement not found');
      await ensureAccountVisible({
        orgId: req.auth.orgId,
        userId: req.auth.userId,
        accountKey: existing.accountKey,
      });
      await prisma.$transaction([
        prisma.contractAgreement.updateMany({
          where: { id: existing.id, orgId: req.auth.orgId, deletedAt: null },
          data: { deletedAt: new Date() },
        }),
        prisma.auditLog.create({
          data: {
            orgId: req.auth.orgId,
            userId: req.auth.userId,
            action: 'contract_agreement.delete',
            targetType: 'contract_agreement',
            targetId: existing.id,
            diff: {},
          },
        }),
      ]);
      return reply.code(204).send(null);
    },
  );

  // ─── OCR + extraction (upload doc → reviewable draft) ────────────────────
  // POST queues a contract-extraction job for an already-uploaded document;
  // GET polls it. Heavy OCR/LLM work stays out of the request path (worker).
  server.post(
    '/contract-agreements/extractions/:id/approve',
    {
      preHandler: [server.requirePermission('accounts:write')],
      schema: {
        params: IdParam,
        body: ContractExtractionApproval,
        response: { 201: ContractAgreement },
      },
    },
    async (req, reply) => {
      const accountKey = normalizeName(req.body.accountKey);
      await ensureAccountVisible({
        orgId: req.auth.orgId,
        userId: req.auth.userId,
        accountKey,
      });
      const { row, file } = await loadCompletedExtractionOrThrow({
        orgId: req.auth.orgId,
        userId: req.auth.userId,
        extractionId: req.params.id,
        expectedAccountKey: accountKey,
      });
      const alreadyApproved = await prisma.contractAgreement.findFirst({
        where: {
          orgId: req.auth.orgId,
          sourceExtractionId: row.id,
          deletedAt: null,
        },
        select: { id: true },
      });
      if (alreadyApproved) {
        throw server.httpErrors.conflict('Source extraction has already been approved');
      }

      const created = await prisma.$transaction(async (tx) => {
        const agreement = await tx.contractAgreement.create({
          data: {
            orgId: req.auth.orgId,
            accountKey,
            sourceFileId: file.id,
            sourceExtractionId: row.id,
            kind: req.body.kind,
            reference: req.body.reference,
            countries: req.body.countries,
            globalRebateBps: req.body.globalRebateBps ?? null,
            currency: req.body.currency,
            rateCard: req.body.rateCard,
            effectiveDate: toDate(req.body.effectiveDate) ?? null,
            expiryDate: toDate(req.body.expiryDate) ?? null,
            rateReviewSchedule: req.body.rateReviewSchedule,
            nextRateReviewAt: toDate(req.body.nextRateReviewAt) ?? null,
            status: req.body.status,
            notes: req.body.notes ?? null,
            createdById: req.auth.userId,
          },
          select: SELECT,
        });
        await tx.auditLog.create({
          data: {
            orgId: req.auth.orgId,
            userId: req.auth.userId,
            action: 'contract_extraction.approve',
            targetType: 'contract_agreement',
            targetId: agreement.id,
            diff: {
              accountKey,
              sourceExtractionId: row.id,
              sourceFileId: file.id,
              reference: agreement.reference,
            },
          },
        });
        return agreement;
      });

      const read = readAgreement(created, row);
      if (!read.ok) {
        req.log.error({ agreementId: created.id }, 'approved agreement could not be serialized');
        throw server.httpErrors.internalServerError(
          'Saved the agreement, but the response could not be read',
        );
      }
      return reply.code(201).send(read.value);
    },
  );

  server.post(
    '/contract-agreements/extract',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      preHandler: [server.requirePermission('accounts:write')],
      schema: {
        body: z.object({ fileId: z.string().uuid() }),
        response: { 200: ContractExtractionResult },
      },
    },
    async (req) => {
      const file = await prisma.fileAttachment.findFirst({
        where: { id: req.body.fileId, orgId: req.auth.orgId, deletedAt: null },
        select: {
          id: true,
          accountId: true,
          companyId: true,
          storageKey: true,
          contentType: true,
          name: true,
        },
      });
      if (!file) throw server.httpErrors.notFound('Document not found');
      await ensureAccountVisible({
        orgId: req.auth.orgId,
        userId: req.auth.userId,
        accountKey: file.accountId,
        companyId: file.companyId,
      });
      const extraction = await prisma.documentExtraction.create({
        data: {
          orgId: req.auth.orgId,
          documentId: file.id,
          accountId: file.accountId,
          companyId: file.companyId,
          status: 'pending',
          extractedData: {},
        },
      });
      await enqueueDocumentExtract({
        orgId: req.auth.orgId,
        accountId: file.accountId,
        documentId: file.id,
        extractionId: extraction.id,
        storageKey: file.storageKey,
        contentType: file.contentType,
        name: file.name,
        extractionKind: 'contract',
      });
      return serializeExtraction(extraction, file, null);
    },
  );

  server.get(
    '/contract-agreements/extractions/:id',
    {
      preHandler: [server.requirePermission('accounts:read')],
      schema: { params: IdParam, response: { 200: ContractExtractionResult } },
    },
    async (req) => {
      const row = await prisma.documentExtraction.findFirst({
        where: { id: req.params.id, orgId: req.auth.orgId, deletedAt: null },
        select: {
          id: true,
          documentId: true,
          accountId: true,
          status: true,
          extractedData: true,
          error: true,
          updatedAt: true,
        },
      });
      if (!row) throw server.httpErrors.notFound('Extraction not found');
      const file = await prisma.fileAttachment.findFirst({
        where: { id: row.documentId, orgId: req.auth.orgId, deletedAt: null },
        select: { id: true, accountId: true, companyId: true, name: true },
      });
      await ensureAccountVisible({
        orgId: req.auth.orgId,
        userId: req.auth.userId,
        accountKey: row.accountId,
        companyId: file?.companyId ?? null,
      });
      const approved = await prisma.contractAgreement.findFirst({
        where: {
          orgId: req.auth.orgId,
          sourceExtractionId: row.id,
          deletedAt: null,
        },
        select: { id: true },
      });
      return serializeExtraction(row, file, approved?.id ?? null);
    },
  );
};
