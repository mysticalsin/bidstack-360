// Create an MSA intake draft from verified file bytes: extract text, cite the
// clause fields, rank account and signing-entity matches, then store the
// FileAttachment and the draft in one transaction. Shared by the one-drop
// upload route and the agreement ingest processor (SharePoint, DocuSign,
// REST, MCP). The draft waits for a person to confirm; nothing else is saved.
import { randomUUID } from 'node:crypto';

import { prisma, type Prisma } from '@bidstack/db';
import {
  extractMsaFields,
  rankAccountMatches,
  rankSigningEntityMatches,
  type MsaAccountMatch,
  type MsaContentType,
} from '@bidstack/shared';

import { getEnv } from '../env.js';
import { extractMsaDocument } from './extract-document.js';

export function intakeKey(draftId: string): string {
  return `msa-intake-${draftId}`;
}

export interface IntakeDraftInput {
  orgId: string;
  /** User recorded as the draft creator (the reviewer of record). */
  userId: string;
  draftId: string;
  fileName: string;
  contentType: MsaContentType;
  buffer: Buffer;
  sha256: string;
  storageKey: string;
  /** A source that names the account (REST metadata.companyId) ranks it first. */
  namedCompanyId?: string | null;
  extraWarnings?: string[];
}

export async function createIntakeDraftFromBuffer(input: IntakeDraftInput) {
  const { orgId } = input;
  const extracted = await extractMsaDocument(input.buffer, input.contentType);
  const fields = extractMsaFields(extracted.pages);
  const usedLlm = getEnv().MSA_LLM_EXTRACT_ENABLED === 'true';
  // LLM path is gated and off by default. Even when the flag is on we do
  // not send the document to a third party from here; the flag is recorded.
  const companies = await prisma.company.findMany({
    where: { orgId, deletedAt: null },
    select: { id: true, name: true, legalName: true, domain: true, address: true },
    take: 500,
  });
  const contacts = await prisma.contact.findMany({
    where: { orgId, deletedAt: null, email: { not: null } },
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
  let accountMatches: MsaAccountMatch[] = rankAccountMatches(
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
  if (input.namedCompanyId) {
    const named = companies.find((c) => c.id === input.namedCompanyId);
    if (named) {
      const rest = accountMatches.filter((m) => m.companyId !== named.id);
      const prior = accountMatches.find((m) => m.companyId === named.id);
      accountMatches = [
        {
          companyId: named.id,
          name: named.name,
          legalName: named.legalName,
          domain: named.domain,
          scoreBps: Math.max(prior?.scoreBps ?? 0, 9_000),
          reasons: [...new Set(['Named by the sending system', ...(prior?.reasons ?? [])])],
        },
        ...rest,
      ];
    }
  }
  const entities = await prisma.signingEntity.findMany({
    where: { orgId, deletedAt: null },
    select: { id: true, slug: true, name: true, legalName: true, aliases: true },
    take: 200,
  });
  const signingEntityMatches = rankSigningEntityMatches(entities, fields);
  const warnings: string[] = [...(input.extraWarnings ?? [])];
  if (extracted.needsOcr) warnings.push('This file looks scanned. Needs OCR; text-layer extraction found too little text.');
  if (!accountMatches.length) warnings.push('No matching account. Create a new account or pick one when you confirm.');
  if (!signingEntityMatches.length) warnings.push('Could not detect our signing entity. Confirm it on the review screen.');
  warnings.push('Missing values stay blank. Nothing is saved until you confirm.');

  const fileId = randomUUID();
  await prisma.$transaction([
    prisma.fileAttachment.create({
      data: {
        id: fileId,
        orgId,
        accountId: intakeKey(input.draftId),
        name: input.fileName,
        contentType: input.contentType,
        bytes: input.buffer.length,
        storageKey: input.storageKey,
        uploadedByUserId: input.userId,
      },
    }),
    prisma.msaIntakeDraft.create({
      data: {
        id: input.draftId,
        orgId,
        status: extracted.needsOcr ? 'needs_ocr' : 'pending_review',
        fileName: input.fileName,
        contentType: input.contentType,
        bytes: input.buffer.length,
        sha256: input.sha256,
        storageKey: input.storageKey,
        fileAttachmentId: fileId,
        extractedText: extracted.text.slice(0, 200_000),
        pageCount: extracted.pageCount,
        needsOcr: extracted.needsOcr,
        usedLlm,
        extractedFields: fields as Prisma.InputJsonValue,
        accountMatches: accountMatches as Prisma.InputJsonValue,
        signingEntityMatches: signingEntityMatches as Prisma.InputJsonValue,
        warnings: warnings as Prisma.InputJsonValue,
        createdById: input.userId,
      },
    }),
  ]);
  const row = await prisma.msaIntakeDraft.findFirstOrThrow({ where: { id: input.draftId, orgId } });
  return { row, needsOcr: extracted.needsOcr, usedLlm, fileAttachmentId: fileId };
}
