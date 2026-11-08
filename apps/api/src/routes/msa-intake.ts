import { randomUUID } from 'node:crypto';

import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';

import { prisma, Prisma } from '@bidstack/db';
import {
  citationsFromFields,
  extractMsaFields,
  MsaAccountMatch,
  MsaExtractedFields,
  MsaIntakeConfirm,
  MsaSigningEntityMatch,
  MsaIntakeConfirmResponse,
  MsaIntakeDraft,
  MsaIntakeFinalize,
  MsaIntakeUploadUrlRequest,
  MsaIntakeUploadUrlResponse,
  MSA_ALLOWED_CONTENT_TYPES,
  MSA_MAX_BYTES,
  rankAccountMatches,
  rankSigningEntityMatches,
  type MsaExtractedField,
} from '@bidstack/shared';

import { applyCompanyScope, getAccessScope } from '../lib/access-scope.js';
import { getEnv } from '../env.js';
import { detectMsaContentType, sha256Hex } from '../msa/file-checks.js';
import { extractMsaDocument } from '../msa/extract-document.js';
import { normalizeName } from '../services/crm/dashboard.utils.js';
import { getStorage, keyBelongsToOrg } from '../storage/index.js';

function intakeKey(draftId: string): string {
  return `msa-intake-${draftId}`;
}

function asFields(value: unknown): ReturnType<typeof extractMsaFields> {
  return MsaExtractedFields.parse(value);
}

function serializeDraft(row: {
  id: string;
  status: string;
  fileName: string;
  contentType: string;
  bytes: number;
  sha256: string;
  needsOcr: boolean;
  usedLlm: boolean;
  pageCount: number | null;
  extractedFields: unknown;
  accountMatches: unknown;
  signingEntityMatches: unknown;
  warnings: unknown;
  confirmedContractId: string | null;
  createdAt: Date;
}) {
  return {
    id: row.id,
    status: row.status as MsaIntakeDraft['status'],
    fileName: row.fileName,
    contentType: row.contentType,
    bytes: row.bytes,
    sha256: row.sha256,
    needsOcr: row.needsOcr,
    usedLlm: row.usedLlm,
    pageCount: row.pageCount,
    extractedFields: asFields(row.extractedFields),
    accountMatches: z.array(MsaAccountMatch).parse(row.accountMatches ?? []),
    signingEntityMatches: z.array(MsaSigningEntityMatch).parse(row.signingEntityMatches ?? []),
    warnings: z.array(z.string()).parse(row.warnings ?? []),
    confirmedContractId: row.confirmedContractId,
    createdAt: row.createdAt.toISOString(),
  };
}

function fieldString(field: MsaExtractedField): string | null {
  return typeof field.value === 'string' && field.value.trim() ? field.value : null;
}

function fieldNumber(field: MsaExtractedField): number | null {
  return typeof field.value === 'number' && Number.isFinite(field.value) ? field.value : null;
}

function fieldBool(field: MsaExtractedField): boolean {
  return field.value === true;
}

export const msaIntakeRoutes: FastifyPluginAsyncZod = async (server) => {
  async function audit(req: FastifyRequest, action: string, targetId: string | null, diff: Record<string, unknown> = {}) {
    await prisma.auditLog.create({
      data: {
        orgId: req.auth.orgId,
        userId: req.auth.userId,
        action,
        targetType: 'msa-intake',
        targetId,
        diff: diff as Prisma.InputJsonValue,
      },
    });
  }

  server.post(
    '/msa/intake/upload-url',
    {
      config: { permission: 'msa:write', rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: { body: MsaIntakeUploadUrlRequest, response: { 200: MsaIntakeUploadUrlResponse } },
    },
    async (req) => {
      const draftId = randomUUID();
      const storage = await getStorage();
      const key = storage.newKey(req.auth.orgId, intakeKey(draftId), req.body.fileName);
      const presigned = await storage.getUploadUrl({
        key,
        contentType: req.body.contentType,
        bytes: req.body.bytes,
      });
      return {
        draftId,
        uploadUrl: presigned.url,
        storageKey: key,
        headers: presigned.headers,
        maxBytes: MSA_MAX_BYTES,
      };
    },
  );

  server.post(
    '/msa/intake',
    {
      config: { permission: 'msa:write', rateLimit: { max: 20, timeWindow: '1 minute' } },
      schema: { body: MsaIntakeFinalize, response: { 201: MsaIntakeDraft } },
    },
    async (req, reply) => {
      const b = req.body;
      if (!keyBelongsToOrg(b.storageKey, req.auth.orgId)) {
        throw server.httpErrors.forbidden('Storage key does not belong to your organization');
      }
      if (!b.storageKey.includes(`/${intakeKey(b.draftId)}/`)) {
        throw server.httpErrors.forbidden('Storage key was not issued for this intake');
      }
      const storage = await getStorage();
      const reject = async (message: string) => {
        await storage.delete(b.storageKey).catch(() => undefined);
        await audit(req, 'msa.intake.rejected', b.draftId, { reason: message, fileName: b.fileName });
        throw server.httpErrors.badRequest(message);
      };
      let meta;
      try {
        meta = await storage.head(b.storageKey);
      } catch {
        throw server.httpErrors.notFound('Uploaded object not found');
      }
      if (meta.bytes !== b.bytes || meta.bytes > MSA_MAX_BYTES) return reject('Uploaded object size does not match');
      const buf = await storage.readBuffer(b.storageKey);
      const detected = detectMsaContentType(buf);
      if (!detected || !(MSA_ALLOWED_CONTENT_TYPES as readonly string[]).includes(detected)) {
        return reject('Only PDF and DOCX files are accepted');
      }
      if (detected !== b.contentType) return reject('File content does not match its declared type');
      const sha256 = sha256Hex(buf);

      const extracted = await extractMsaDocument(buf, detected);
      const fields = extractMsaFields(extracted.pages);
      const usedLlm = getEnv().MSA_LLM_EXTRACT_ENABLED === 'true';
      // LLM path is gated and off by default. Even when the flag is on we do
      // not send the document to a third party from this route; refinement
      // would be a future in-process hook. The flag is recorded on the draft.
      const companies = await prisma.company.findMany({
        where: { orgId: req.auth.orgId, deletedAt: null },
        select: { id: true, name: true, legalName: true, domain: true, address: true },
        take: 500,
      });
      const contacts = await prisma.contact.findMany({
        where: { orgId: req.auth.orgId, deletedAt: null, email: { not: null } },
        select: { customer: true, email: true },
        take: 1000,
      });
      const emailsByCustomer = new Map<string, string[]>();
      for (const c of contacts) {
        if (!c.email) continue;
        const list = emailsByCustomer.get(c.customer) ?? [];
        list.push(c.email);
        emailsByCustomer.set(c.customer, list);
      }
      const accountMatches = rankAccountMatches(
        companies.map((c) => ({
          companyId: c.id,
          name: c.name,
          legalName: c.legalName,
          domain: c.domain,
          address: typeof c.address === 'string' ? c.address : c.address ? JSON.stringify(c.address) : null,
          emails: emailsByCustomer.get(c.name) ?? [],
        })),
        fields,
      );
      const entities = await prisma.signingEntity.findMany({
        where: { orgId: req.auth.orgId, deletedAt: null },
        select: { id: true, slug: true, name: true, legalName: true, aliases: true },
        take: 200,
      });
      const signingEntityMatches = rankSigningEntityMatches(entities, fields);
      const warnings: string[] = [];
      if (extracted.needsOcr) warnings.push('This file looks scanned. Needs OCR; text-layer extraction found too little text.');
      if (!accountMatches.length) warnings.push('No matching account. Create a new account or pick one when you confirm.');
      if (!signingEntityMatches.length) warnings.push('Could not detect our signing entity. Confirm it on the review screen.');
      warnings.push('Missing values stay blank. Nothing is saved until you confirm.');

      const fileId = randomUUID();
      await prisma.$transaction([
        prisma.fileAttachment.create({
          data: {
            id: fileId,
            orgId: req.auth.orgId,
            accountId: intakeKey(b.draftId),
            name: b.fileName,
            contentType: detected,
            bytes: meta.bytes,
            storageKey: b.storageKey,
            uploadedByUserId: req.auth.userId,
          },
        }),
        prisma.msaIntakeDraft.create({
          data: {
            id: b.draftId,
            orgId: req.auth.orgId,
            status: extracted.needsOcr ? 'needs_ocr' : 'pending_review',
            fileName: b.fileName,
            contentType: detected,
            bytes: meta.bytes,
            sha256,
            storageKey: b.storageKey,
            fileAttachmentId: fileId,
            extractedText: extracted.text.slice(0, 200_000),
            pageCount: extracted.pageCount,
            needsOcr: extracted.needsOcr,
            usedLlm,
            extractedFields: fields as Prisma.InputJsonValue,
            accountMatches: accountMatches as Prisma.InputJsonValue,
            signingEntityMatches: signingEntityMatches as Prisma.InputJsonValue,
            warnings: warnings as Prisma.InputJsonValue,
            createdById: req.auth.userId,
          },
        }),
      ]);
      const row = await prisma.msaIntakeDraft.findFirstOrThrow({ where: { id: b.draftId, orgId: req.auth.orgId } });
      await audit(req, 'msa.intake.created', row.id, { fileName: b.fileName, needsOcr: extracted.needsOcr, usedLlm });
      return reply.code(201).send(serializeDraft(row));
    },
  );

  server.get(
    '/msa/intake/:id',
    {
      config: { permission: 'msa:read' },
      schema: { params: z.object({ id: z.string().uuid() }), response: { 200: MsaIntakeDraft } },
    },
    async (req) => {
      const row = await prisma.msaIntakeDraft.findFirst({
        where: { id: req.params.id, orgId: req.auth.orgId, deletedAt: null },
      });
      if (!row) throw server.httpErrors.notFound('Intake draft not found');
      return serializeDraft(row);
    },
  );

  server.post(
    '/msa/intake/:id/confirm',
    {
      config: { permission: 'msa:write' },
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: MsaIntakeConfirm,
        response: { 201: MsaIntakeConfirmResponse },
      },
    },
    async (req, reply) => {
      const draft = await prisma.msaIntakeDraft.findFirst({
        where: { id: req.params.id, orgId: req.auth.orgId, deletedAt: null },
      });
      if (!draft) throw server.httpErrors.notFound('Intake draft not found');
      if (draft.status === 'confirmed' && draft.confirmedContractId) {
        return reply.code(201).send({
          contractId: draft.confirmedContractId,
          companyId: (await prisma.contractAgreement.findFirst({ where: { id: draft.confirmedContractId } }))?.companyId ?? '',
          createdCompany: false,
        });
      }
      if (draft.status === 'needs_ocr') {
        throw server.httpErrors.badRequest('This file needs OCR. Confirm is blocked until a text layer exists.');
      }
      const scope = await getAccessScope(req.auth.orgId, req.auth.userId);
      const fields = asFields(draft.extractedFields);
      const overrides = req.body.fieldOverrides ?? {};
      let createdCompany = false;
      let companyId = req.body.companyId ?? null;
      if (!companyId && req.body.createCompany?.name) {
        const created = await prisma.company.create({
          data: {
            orgId: req.auth.orgId,
            name: req.body.createCompany.name,
            legalName: req.body.createCompany.name,
            domain: req.body.createCompany.domain ?? null,
            source: 'msa_intake',
          },
        });
        companyId = created.id;
        createdCompany = true;
      }
      if (!companyId) throw server.httpErrors.badRequest('Pick an existing account or create a new one');
      const company = await prisma.company.findFirst({
        where: applyCompanyScope({ id: companyId, orgId: req.auth.orgId, deletedAt: null }, scope),
        select: { id: true, name: true },
      });
      if (!company) throw server.httpErrors.notFound('Company not found');

      let signingEntityId = req.body.signingEntityId ?? null;
      if (signingEntityId) {
        const entity = await prisma.signingEntity.findFirst({
          where: { id: signingEntityId, orgId: req.auth.orgId, deletedAt: null },
          select: { id: true },
        });
        if (!entity) throw server.httpErrors.badRequest('Signing entity not found');
      } else {
        const matches = rankSigningEntityMatches(
          await prisma.signingEntity.findMany({
            where: { orgId: req.auth.orgId, deletedAt: null },
            select: { id: true, slug: true, name: true, legalName: true, aliases: true },
            take: 200,
          }),
          fields,
        );
        signingEntityId = matches[0]?.entityId ?? null;
      }

      const cap = overrides.liabilityCap !== undefined
        ? overrides.liabilityCap
        : fields.liabilityCap.found
          ? (fields.liabilityCap.value as { amountMicros: number; currency: string })
          : null;
      const contractId = randomUUID();
      const title =
        req.body.title ??
        `${company.name} MSA`;
      const versionId = randomUUID();
      await prisma.$transaction([
        prisma.contractAgreement.create({
          data: {
            id: contractId,
            orgId: req.auth.orgId,
            accountKey: normalizeName(company.name),
            companyId: company.id,
            kind: req.body.kind,
            title,
            reference: fieldString(fields.clientParty) ? `${normalizeName(company.name)}-msa` : title,
            counterparty: overrides.counterparty ?? fieldString(fields.clientParty),
            status: req.body.status,
            effectiveDate: overrides.effectiveDate ? new Date(overrides.effectiveDate) : fieldString(fields.effectiveDate) ? new Date(fieldString(fields.effectiveDate)!) : null,
            expiryDate: overrides.expiryDate ? new Date(overrides.expiryDate) : fieldString(fields.expiryDate) ? new Date(fieldString(fields.expiryDate)!) : null,
            autoRenew: overrides.autoRenew ?? fieldBool(fields.autoRenew),
            noticePeriodDays: overrides.noticePeriodDays ?? fieldNumber(fields.noticePeriodDays),
            governingLaw: overrides.governingLaw ?? fieldString(fields.governingLaw),
            liabilityCapMicros: cap ? BigInt(cap.amountMicros) : null,
            liabilityCapCurrency: cap?.currency ?? null,
            paymentTerms: overrides.paymentTerms ?? fieldString(fields.paymentTerms),
            termMonths: overrides.termMonths ?? fieldNumber(fields.termMonths),
            renewalTerms: overrides.renewalTerms ?? fieldString(fields.renewalTerms),
            ipClause: overrides.ipClause ?? fieldString(fields.ip),
            confidentiality: overrides.confidentiality ?? fieldString(fields.confidentiality),
            nonSolicit: overrides.nonSolicit ?? fieldString(fields.nonSolicit),
            exclusivity: overrides.exclusivity ?? fieldString(fields.exclusivity),
            insurance: overrides.insurance ?? fieldString(fields.insurance),
            indexation: overrides.indexation ?? fieldString(fields.indexation),
            scopeOfServices: overrides.scopeOfServices ?? fieldString(fields.scopeOfServices),
            affiliatesClause: overrides.affiliatesClause ?? fieldString(fields.affiliatesClause),
            parties: (fields.parties.value ?? []) as Prisma.InputJsonValue,
            fieldCitations: citationsFromFields(fields) as Prisma.InputJsonValue,
            signingEntityId,
            rateCard: (fields.rateCard.value ?? []) as Prisma.InputJsonValue,
            sourceFileId: draft.fileAttachmentId,
            createdById: req.auth.userId,
            ownerId: req.auth.userId,
          },
        }),
        prisma.contractFileVersion.create({
          data: {
            id: versionId,
            orgId: req.auth.orgId,
            contractId,
            versionNo: 1,
            fileAttachmentId: draft.fileAttachmentId!,
            fileName: draft.fileName,
            contentType: draft.contentType,
            bytes: draft.bytes,
            sha256: draft.sha256,
            extractionStatus: 'done',
            extractedText: draft.extractedText,
            extractedAt: new Date(),
            createdById: req.auth.userId,
          },
        }),
        prisma.msaIntakeDraft.update({
          where: { id: draft.id },
          data: { status: 'confirmed', confirmedContractId: contractId },
        }),
      ]);
      if (draft.fileAttachmentId) {
        await prisma.fileAttachment.update({
          where: { id: draft.fileAttachmentId },
          data: { companyId: company.id, accountId: `msa-${contractId}` },
        }).catch(() => undefined);
      }
      await audit(req, 'msa.intake.confirmed', draft.id, { contractId, companyId: company.id, createdCompany });
      return reply.code(201).send({ contractId, companyId: company.id, createdCompany });
    },
  );
}
