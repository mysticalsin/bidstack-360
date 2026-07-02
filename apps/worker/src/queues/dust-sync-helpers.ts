// Shared helpers for mapping Dust documents to BidStack CRM entities.
// Used by both the scheduled poll worker and the webhook processor.
//
// Conflict resolution: if a CRM record has dustLastPushedAt within the last
// 5 minutes, we skip the Dust → CRM write to avoid overwriting our own
// outbound sync. This creates a simple back-pressure valve for bidirectional
// sync without a full vector-clock system.

import { prisma, type Prisma } from '@bidstack/db';

const CONFLICT_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

export interface DustDocInput {
  document_id: string;
  text?: string;
  metadata?: Record<string, unknown>;
}

export function normalizeName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export async function getFirstUserId(orgId: string): Promise<string | null> {
  const user = await prisma.user.findFirst({
    where: { orgId },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  return user?.id ?? null;
}

/** Returns true if the record was recently pushed and should not be overwritten. */
function isInConflictWindow(dustLastPushedAt: Date | null): boolean {
  if (!dustLastPushedAt) return false;
  return Date.now() - dustLastPushedAt.getTime() < CONFLICT_WINDOW_MS;
}

export async function upsertOpportunityFromDust(
  orgId: string,
  doc: DustDocInput,
): Promise<{ id: string; created: boolean; skipped: boolean }> {
  const meta = doc.metadata ?? {};
  const code = String(meta.opportunity_code ?? '');
  if (!code) throw new Error('Missing opportunity_code in Dust document metadata');

  const name = String(meta.opportunity_name ?? doc.text?.slice(0, 100) ?? 'Untitled');
  const customer = String(meta.customer_name ?? meta.company_name ?? 'Unknown');

  const existing = await prisma.opportunity.findUnique({
    where: { orgId_code: { orgId, code } },
    select: { id: true, intel: true, dustLastPushedAt: true },
  });

  if (isInConflictWindow(existing?.dustLastPushedAt ?? null)) {
    return { id: existing!.id, created: false, skipped: true };
  }

  const intel = {
    ...(typeof existing?.intel === 'object' && existing.intel !== null ? existing.intel : {}),
    dustDocId: doc.document_id,
    dustText: doc.text?.slice(0, 5000) ?? null,
    syncedAt: new Date().toISOString(),
  };

  const opp = await prisma.opportunity.upsert({
    where: { orgId_code: { orgId, code } },
    create: {
      orgId,
      code,
      customer,
      name,
      stage: 's1_ongoing',
      intel: intel as Prisma.InputJsonValue,
      dustDocId: doc.document_id,
    },
    update: {
      intel: intel as Prisma.InputJsonValue,
      dustDocId: doc.document_id,
      ...(name !== 'Untitled' ? { name } : {}),
    },
  });

  await prisma.auditLog.create({
    data: {
      orgId,
      action: existing ? 'opportunity.updated.dust' : 'opportunity.created.dust',
      targetType: 'opportunity',
      targetId: opp.id,
      diff: { code, dustDocId: doc.document_id } as Prisma.InputJsonValue,
    },
  });

  return { id: opp.id, created: !existing, skipped: false };
}

export async function upsertCompanyFromDust(
  orgId: string,
  doc: DustDocInput,
): Promise<{ id: string; created: boolean }> {
  const meta = doc.metadata ?? {};
  const companyName = String(meta.company_name ?? '');
  if (!companyName) throw new Error('Missing company_name in Dust document metadata');

  const normalizedName = normalizeName(companyName);

  const existing = await prisma.companyEnrichment.findUnique({
    where: { orgId_normalizedName: { orgId, normalizedName } },
    select: { id: true },
  });

  const enrichment = await prisma.companyEnrichment.upsert({
    where: { orgId_normalizedName: { orgId, normalizedName } },
    create: {
      orgId,
      normalizedName,
      legalName: companyName,
      tradeName: companyName,
      providerMetadata: {
        dustDocId: doc.document_id,
        dustText: doc.text?.slice(0, 5000) ?? null,
        syncedAt: new Date().toISOString(),
      } as Prisma.InputJsonValue,
    },
    update: {
      providerMetadata: {
        dustDocId: doc.document_id,
        dustText: doc.text?.slice(0, 5000) ?? null,
        syncedAt: new Date().toISOString(),
      } as Prisma.InputJsonValue,
    },
  });

  await prisma.auditLog.create({
    data: {
      orgId,
      action: existing ? 'company.updated.dust' : 'company.created.dust',
      targetType: 'company_enrichment',
      targetId: enrichment.id,
      diff: { companyName, normalizedName, dustDocId: doc.document_id } as Prisma.InputJsonValue,
    },
  });

  return { id: enrichment.id, created: !existing };
}

export async function upsertNoteFromDust(
  orgId: string,
  doc: DustDocInput,
): Promise<{ id: string; created: boolean } | null> {
  const meta = doc.metadata ?? {};
  const accountId = String(meta.account_id ?? meta.customer_name ?? meta.company_name ?? 'general');
  const title = String(meta.title ?? doc.document_id);

  const authorUserId = await getFirstUserId(orgId);
  if (!authorUserId) return null;

  // Upsert by dustDocId to prevent duplicates on re-sync.
  const existing = await prisma.note.findFirst({
    where: { orgId, dustDocId: doc.document_id },
    select: { id: true },
  });

  const note = await prisma.note.upsert({
    where: { id: existing?.id ?? '' },
    create: {
      orgId,
      accountId,
      authorUserId,
      title: title.slice(0, 200),
      bodyMd: doc.text ?? '',
      dustDocId: doc.document_id,
    },
    update: {
      title: title.slice(0, 200),
      bodyMd: doc.text ?? '',
    },
  });

  await prisma.auditLog.create({
    data: {
      orgId,
      action: existing ? 'note.updated.dust' : 'note.created.dust',
      targetType: 'note',
      targetId: note.id,
      diff: { title, accountId, dustDocId: doc.document_id } as Prisma.InputJsonValue,
    },
  });

  return { id: note.id, created: !existing };
}

export async function upsertLeadFromDust(
  orgId: string,
  doc: DustDocInput,
): Promise<{ id: string; created: boolean; skipped: boolean }> {
  const meta = doc.metadata ?? {};
  const email = String(meta.lead_email ?? '');
  const firstName = String(meta.lead_first_name ?? doc.text?.slice(0, 50) ?? 'Unknown');
  const lastName = String(meta.lead_last_name ?? '');
  const companyName = String(meta.company_name ?? 'Unknown');

  if (!email && !lastName) {
    throw new Error('Missing lead_email or lead_last_name in Dust document metadata');
  }

  // When the doc has no email, do NOT run an email-keyed lookup — Prisma drops
  // undefined where-keys, so `{ orgId, email: undefined }` silently became
  // `{ orgId }` and findFirst matched (then upsert overwrote) an ARBITRARY
  // pre-existing lead in the org. Instead match by this document's own
  // dustDocId (idempotency key for re-delivery), same pattern as
  // upsertNoteFromDust above.
  const existing = email
    ? await prisma.lead.findFirst({
        where: { orgId, email },
        select: { id: true, dustLastPushedAt: true },
      })
    : await prisma.lead.findFirst({
        where: { orgId, dustDocId: doc.document_id },
        select: { id: true, dustLastPushedAt: true },
      });

  if (isInConflictWindow(existing?.dustLastPushedAt ?? null)) {
    return { id: existing!.id, created: false, skipped: true };
  }

  const lead = await prisma.lead.upsert({
    where: { id: existing?.id ?? '' },
    create: {
      orgId,
      firstName,
      lastName,
      email: email || null,
      companyName,
      source: 'dust',
      status: 'new',
      dustDocId: doc.document_id,
      notes: doc.text?.slice(0, 5000) ?? null,
    },
    update: {
      firstName,
      lastName,
      companyName,
      dustDocId: doc.document_id,
      notes: doc.text?.slice(0, 5000) ?? null,
    },
  });

  await prisma.auditLog.create({
    data: {
      orgId,
      action: existing ? 'lead.updated.dust' : 'lead.created.dust',
      targetType: 'lead',
      targetId: lead.id,
      diff: { email, dustDocId: doc.document_id } as Prisma.InputJsonValue,
    },
  });

  return { id: lead.id, created: !existing, skipped: false };
}
