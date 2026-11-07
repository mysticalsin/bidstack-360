// Process one AgreementIngestItem into the MSA intake pipeline (slice 13a).
//
// Order: claim the row, get the bytes (inline, SSRF-guarded URL, or handed in
// by a source sync), verify PDF/DOCX from the bytes, dedupe by sha256, then
// either add a ContractFileVersion to the agreement the same external document
// already became, or create an intake draft for a person to review. Every
// outcome is audited and the reviewer gets an in-app notification. Nothing
// here creates or edits agreement fields.
import { randomUUID } from 'node:crypto';

import { prisma, Prisma } from '@bidstack/db';
import { MSA_MAX_BYTES, type MsaContentType } from '@bidstack/shared';
import { assertUrlResolvesPublic } from '@bidstack/shared/server';

import { applyCompanyScope, getAccessScope } from '../../lib/access-scope.js';
import { createLogger } from '../../lib/logger.js';
import { detectMsaContentType, sha256Hex } from '../../msa/file-checks.js';
import { createIntakeDraftFromBuffer, intakeKey } from '../../msa/intake-draft.js';
import { enqueueMsaTextExtract } from '../../queues/msa-text-extract.js';
import { getStorage } from '../../storage/index.js';
import { readBodyCapped } from '../agreement-sources/read-capped.js';

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

const log = createLogger({ name: 'agreement-ingest:process' });

const MAX_REDIRECTS = 3;
const URL_FETCH_TIMEOUT_MS = 30_000;

export class IngestRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IngestRejectedError';
  }
}

export interface ProcessOutcome {
  status: 'drafted' | 'versioned' | 'duplicate' | 'rejected' | 'failed' | 'skipped';
  itemId: string;
  intakeDraftId?: string | null;
  contractId?: string | null;
  error?: string | null;
}

type ItemForProcess = {
  id: string;
  orgId: string;
  sourceId: string | null;
  channel: string;
  externalSource: string;
  externalId: string;
  fileName: string;
  contentType: string | null;
  fileUrl: string | null;
  metadata: Prisma.JsonValue;
  actorType: string;
  actorId: string | null;
};

const ITEM_FOR_PROCESS = {
  id: true,
  orgId: true,
  sourceId: true,
  channel: true,
  externalSource: true,
  externalId: true,
  fileName: true,
  contentType: true,
  fileUrl: true,
  metadata: true,
  actorType: true,
  actorId: true,
} as const;

/** Read a body without trusting content-length; stop as soon as it passes the cap. */
export async function readCapped(res: Response): Promise<Buffer> {
  const buf = await readBodyCapped(res, MSA_MAX_BYTES);
  if (!buf) throw new IngestRejectedError('File is larger than 25 MB');
  return buf;
}

/**
 * Fetch a sender-supplied URL with the SSRF guard on every hop: the host must
 * resolve to public addresses only, redirects are followed by hand and
 * re-validated, and the body is capped at the agreement size limit.
 */
export async function fetchAgreementUrl(rawUrl: string, fetchFn: FetchFn = fetch): Promise<Buffer> {
  let url = rawUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const safe = await assertUrlResolvesPublic(url).catch((err: unknown) => {
      throw new IngestRejectedError(err instanceof Error ? err.message : 'URL is not allowed');
    });
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), URL_FETCH_TIMEOUT_MS);
    try {
      const res = await fetchFn(safe.toString(), { redirect: 'manual', signal: ctl.signal });
      if (res.status >= 300 && res.status < 400) {
        const next = res.headers.get('location');
        if (!next) throw new IngestRejectedError('Redirect without a location');
        url = new URL(next, safe).toString();
        continue;
      }
      if (!res.ok) throw new IngestRejectedError(`File URL answered ${res.status}`);
      const declared = Number(res.headers.get('content-length') ?? '0');
      if (declared > MSA_MAX_BYTES) throw new IngestRejectedError('File is larger than 25 MB');
      return await readCapped(res);
    } finally {
      clearTimeout(timer);
    }
  }
  throw new IngestRejectedError('Too many redirects');
}

/** The person whose review queue gets the draft. Drafts need a User row. */
export async function resolveReviewer(item: Pick<ItemForProcess, 'orgId' | 'actorType' | 'actorId' | 'sourceId'>): Promise<string | null> {
  if (item.actorType === 'user' && item.actorId) {
    const user = await prisma.user.findFirst({ where: { id: item.actorId, orgId: item.orgId, deletedAt: null }, select: { id: true } });
    if (user) return user.id;
  }
  if (item.sourceId) {
    const source = await prisma.agreementSource.findFirst({ where: { id: item.sourceId, orgId: item.orgId }, select: { createdById: true } });
    if (source) return source.createdById;
  }
  const admin = await prisma.user.findFirst({
    where: {
      orgId: item.orgId,
      deletedAt: null,
      userRoles: { some: { deletedAt: null, role: { name: 'Admin' } } },
    },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  return admin?.id ?? null;
}

const SIDE_EFFECT_TRIES = 3;

/**
 * Audit and notification writes after the outcome is saved. They retry on
 * their own and never throw: a failure here must not send a finished item
 * back to the queue and process the document twice.
 */
async function afterFinish(itemId: string, what: string, fn: () => Promise<unknown>): Promise<void> {
  for (let attempt = 1; attempt <= SIDE_EFFECT_TRIES; attempt += 1) {
    try {
      await fn();
      return;
    } catch (err) {
      if (attempt === SIDE_EFFECT_TRIES) {
        log.error({ itemId, what, err: err instanceof Error ? err.message : String(err) }, 'agreement ingest side effect failed');
        return;
      }
      await new Promise((r) => setTimeout(r, 50 * attempt));
    }
  }
}

async function finish(
  item: ItemForProcess,
  status: ProcessOutcome['status'],
  data: Prisma.AgreementIngestItemUpdateInput,
  audit: Record<string, unknown>,
): Promise<void> {
  await prisma.agreementIngestItem.update({
    where: { id: item.id },
    data: { status, pendingContent: null, processedAt: new Date(), nextAttemptAt: null, ...data },
  });
  await afterFinish(item.id, 'audit', () =>
    prisma.auditLog.create({
      data: {
        orgId: item.orgId,
        userId: item.actorType === 'user' ? item.actorId : null,
        action: `agreement.ingest.${status}`,
        targetType: 'agreement_ingest_item',
        targetId: item.id,
        diff: {
          channel: item.channel,
          externalSource: item.externalSource,
          externalId: item.externalId,
          ...audit,
        } as Prisma.InputJsonValue,
      },
    }),
  );
}

async function notify(orgId: string, userId: string, title: string, body: string, url: string, entityId: string) {
  await afterFinish(entityId, 'notification', () =>
    prisma.notification.create({
      data: { orgId, userId, type: 'system', title: title.slice(0, 250), body, entityType: 'agreement_ingest', entityId, url },
    }),
  );
}

/**
 * Earlier document from the same external record and the same sender (source,
 * user or API key) that already became an agreement. A duplicate counts too:
 * when the first copy matched a file already on an agreement, changed bytes
 * for that record must still become a new version of it.
 */
async function priorContractId(item: ItemForProcess): Promise<string | null> {
  const prior = await prisma.agreementIngestItem.findMany({
    where: {
      orgId: item.orgId,
      externalSource: item.externalSource,
      externalId: item.externalId,
      ...(item.sourceId ? { sourceId: item.sourceId } : { actorType: item.actorType, actorId: item.actorId }),
      id: { not: item.id },
      OR: [
        { status: { in: ['drafted', 'versioned'] } },
        { status: 'duplicate', OR: [{ contractId: { not: null } }, { intakeDraftId: { not: null } }] },
      ],
    },
    orderBy: { createdAt: 'desc' },
    select: { contractId: true, intakeDraftId: true },
    take: 20,
  });
  for (const p of prior) {
    if (p.contractId) return p.contractId;
  }
  const draftIds = prior.map((p) => p.intakeDraftId).filter((id): id is string => Boolean(id));
  if (draftIds.length === 0) return null;
  const confirmed = await prisma.msaIntakeDraft.findFirst({
    where: { orgId: item.orgId, id: { in: draftIds }, confirmedContractId: { not: null } },
    orderBy: { updatedAt: 'desc' },
    select: { confirmedContractId: true },
  });
  return confirmed?.confirmedContractId ?? null;
}

/** Sources are admin-configured; users and API keys must still see the agreement's account. */
async function senderMaySeeCompany(item: ItemForProcess, companyId: string | null): Promise<boolean> {
  if (item.actorType === 'source') return true;
  if (!item.actorId) return false;
  if (item.actorType === 'api_key') {
    const key = await prisma.apiKey.findFirst({
      where: { id: item.actorId, orgId: item.orgId },
      select: { unrestrictedScope: true, companyIds: true },
    });
    if (!key) return false;
    return key.unrestrictedScope || (companyId !== null && key.companyIds.includes(companyId));
  }
  const scope = await getAccessScope(item.orgId, item.actorId);
  if (scope.unrestricted) return true;
  if (!companyId) return false;
  const visible = await prisma.company.findFirst({
    where: applyCompanyScope({ orgId: item.orgId, id: companyId, deletedAt: null }, scope),
    select: { id: true },
  });
  return Boolean(visible);
}

async function addVersion(item: ItemForProcess, contractId: string, buf: Buffer, contentType: MsaContentType, sha256: string, reviewerId: string) {
  const contract = await prisma.contractAgreement.findFirst({
    where: { id: contractId, orgId: item.orgId, deletedAt: null },
    select: { id: true, companyId: true, title: true, reference: true, ownerId: true },
  });
  if (!contract) return null;
  if (!(await senderMaySeeCompany(item, contract.companyId))) {
    throw new IngestRejectedError('The earlier agreement for this record is outside this sender scope');
  }
  const storage = await getStorage();
  if (!storage.putObject) throw new Error('Storage driver cannot write server-side objects');
  const storageKey = storage.newKey(item.orgId, `msa-${contract.id}`, item.fileName);
  await storage.putObject(storageKey, buf, contentType);
  const fileId = randomUUID();
  const versionId = randomUUID();
  let versionNo = 0;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const max = await prisma.contractFileVersion.aggregate({
      where: { contractId: contract.id, deletedAt: {} },
      _max: { versionNo: true },
    });
    versionNo = (max._max.versionNo ?? 0) + 1;
    try {
      await prisma.$transaction([
        prisma.fileAttachment.create({
          data: {
            id: fileId,
            orgId: item.orgId,
            accountId: `msa-${contract.id}`,
            companyId: contract.companyId,
            name: item.fileName,
            contentType,
            bytes: buf.length,
            storageKey,
            uploadedByUserId: reviewerId,
          },
        }),
        prisma.contractFileVersion.create({
          data: {
            id: versionId,
            orgId: item.orgId,
            contractId: contract.id,
            versionNo,
            fileAttachmentId: fileId,
            fileName: item.fileName,
            contentType,
            bytes: buf.length,
            sha256,
            note: `From ${item.channel}: ${item.externalSource} ${item.externalId}`.slice(0, 1000),
            createdById: reviewerId,
          },
        }),
      ]);
      break;
    } catch (err) {
      const retry = err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002' && attempt < 2;
      if (!retry) throw err;
    }
  }
  await enqueueMsaTextExtract({ orgId: item.orgId, contractId: contract.id, versionId });
  return { contract, versionId, versionNo };
}

/**
 * Run the intake pipeline on bytes the caller already holds. Used by the
 * queue (inline or URL items) and by source syncs (Graph, DocuSign).
 */
export async function processAgreementBytes(item: ItemForProcess, buf: Buffer): Promise<ProcessOutcome> {
  const reject = async (message: string): Promise<ProcessOutcome> => {
    await finish(item, 'rejected', { error: message.slice(0, 500), bytes: buf.length }, { reason: message });
    return { status: 'rejected', itemId: item.id, error: message };
  };
  if (buf.length === 0) return reject('File is empty');
  if (buf.length > MSA_MAX_BYTES) return reject('File is larger than 25 MB');
  const detected = detectMsaContentType(buf);
  if (!detected) return reject('Only PDF and DOCX files are accepted');
  if (item.contentType && item.contentType !== detected) return reject('File content does not match its declared type');
  const sha256 = sha256Hex(buf);
  const base = { sha256, bytes: buf.length, contentType: detected };

  const [sameItem, sameVersion] = await Promise.all([
    prisma.agreementIngestItem.findFirst({
      where: { orgId: item.orgId, sha256, id: { not: item.id }, status: { in: ['drafted', 'versioned'] } },
      orderBy: { createdAt: 'asc' },
      select: { id: true, intakeDraftId: true, contractId: true },
    }),
    prisma.contractFileVersion.findFirst({
      where: { orgId: item.orgId, sha256, deletedAt: null },
      select: { contractId: true, versionNo: true },
    }),
  ]);
  if (sameItem || sameVersion) {
    const duplicateOf = sameItem?.id ?? null;
    const meta = { ...((item.metadata ?? {}) as Record<string, unknown>), ...(duplicateOf ? { duplicateOf } : {}) };
    await finish(
      item,
      'duplicate',
      {
        ...base,
        metadata: meta as Prisma.InputJsonValue,
        intakeDraftId: sameItem?.intakeDraftId ?? null,
        contractId: sameItem?.contractId ?? sameVersion?.contractId ?? null,
      },
      { sha256, duplicateOf, contractId: sameVersion?.contractId ?? null },
    );
    return { status: 'duplicate', itemId: item.id, contractId: sameVersion?.contractId ?? sameItem?.contractId ?? null };
  }

  const reviewerId = await resolveReviewer(item);
  if (!reviewerId) {
    await finish(item, 'failed', { ...base, error: 'No reviewer in this organization' }, { reason: 'no_reviewer' });
    return { status: 'failed', itemId: item.id, error: 'No reviewer in this organization' };
  }

  const existingContractId = await priorContractId(item);
  if (existingContractId) {
    const version = await addVersion(item, existingContractId, buf, detected, sha256, reviewerId);
    if (version) {
      await finish(
        item,
        'versioned',
        { ...base, contractId: version.contract.id, contractFileVersionId: version.versionId },
        { contractId: version.contract.id, versionId: version.versionId, versionNo: version.versionNo, sha256 },
      );
      const owner = version.contract.ownerId ?? reviewerId;
      await notify(
        item.orgId,
        owner,
        `New version of ${version.contract.title ?? version.contract.reference}`,
        `Version ${version.versionNo} arrived from ${item.channel}. Review the changes before relying on it.`,
        `/agreements/${version.contract.id}`,
        item.id,
      );
      return { status: 'versioned', itemId: item.id, contractId: version.contract.id };
    }
  }

  const storage = await getStorage();
  if (!storage.putObject) throw new Error('Storage driver cannot write server-side objects');
  const draftId = randomUUID();
  const storageKey = storage.newKey(item.orgId, intakeKey(draftId), item.fileName);
  await storage.putObject(storageKey, buf, detected);
  const meta = (item.metadata ?? {}) as { companyId?: string; counterparty?: string; signedAt?: string; title?: string };
  const hints: string[] = [];
  if (meta.counterparty) hints.push(`Sending system names the counterparty: ${meta.counterparty}.`);
  if (meta.signedAt) hints.push(`Signed on ${meta.signedAt.slice(0, 10)} according to the sending system.`);
  let row: { id: string };
  try {
    ({ row } = await createIntakeDraftFromBuffer({
      orgId: item.orgId,
      userId: reviewerId,
      draftId,
      fileName: item.fileName,
      contentType: detected,
      buffer: buf,
      sha256,
      storageKey,
      namedCompanyId: meta.companyId ?? null,
      extraWarnings: hints,
    }));
  } catch (err) {
    // Database trouble is worth retrying; anything else here is the parser
    // failing on these bytes, and the same bytes will fail again.
    if (isDatabaseError(err)) throw err;
    throw new IngestRejectedError(`The file could not be read: ${err instanceof Error ? err.message.slice(0, 200) : 'unknown error'}`);
  }
  await finish(item, 'drafted', { ...base, intakeDraftId: row.id }, { draftId: row.id, sha256 });
  await notify(
    item.orgId,
    reviewerId,
    `Review ${meta.title ?? item.fileName}`,
    `An agreement arrived from ${item.channel}. Nothing is saved until you confirm it.`,
    `/agreements/intake/${row.id}`,
    item.id,
  );
  return { status: 'drafted', itemId: item.id, intakeDraftId: row.id };
}

function isDatabaseError(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError ||
    err instanceof Prisma.PrismaClientUnknownRequestError ||
    err instanceof Prisma.PrismaClientInitializationError ||
    err instanceof Prisma.PrismaClientRustPanicError
  );
}

/** Claim a queued row so two consumers never process the same item. */
async function claim(orgId: string, itemId: string): Promise<boolean> {
  const res = await prisma.agreementIngestItem.updateMany({
    where: { id: itemId, orgId, status: 'queued' },
    data: { status: 'processing', attempts: { increment: 1 } },
  });
  return res.count === 1;
}

/** Queue entry point for REST and MCP items (inline bytes or a URL). */
export async function processAgreementIngestItem(
  orgId: string,
  itemId: string,
  deps: { fetch?: FetchFn } = {},
): Promise<ProcessOutcome> {
  if (!(await claim(orgId, itemId))) return { status: 'skipped', itemId };
  const row = await prisma.agreementIngestItem.findFirst({
    where: { id: itemId, orgId },
    select: { ...ITEM_FOR_PROCESS, pendingContent: true },
  });
  if (!row) return { status: 'skipped', itemId };
  const { pendingContent, ...item } = row;
  try {
    let buf: Buffer;
    if (pendingContent) buf = Buffer.from(pendingContent);
    else if (item.fileUrl) buf = await fetchAgreementUrl(item.fileUrl, deps.fetch);
    else throw new IngestRejectedError('Item has no file content or URL');
    return await processAgreementBytes(item, buf);
  } catch (err) {
    if (err instanceof IngestRejectedError) {
      await finish(item, 'rejected', { error: err.message.slice(0, 500) }, { reason: err.message });
      return { status: 'rejected', itemId, error: err.message };
    }
    const message = err instanceof Error ? err.message : 'Processing failed';
    // Back to queued so the sweep retries, but only while the document itself
    // is unfinished; a saved outcome is never processed again.
    const requeued = await prisma.agreementIngestItem.updateMany({
      where: { id: itemId, orgId, status: 'processing' },
      data: { status: 'queued', error: message.slice(0, 500) },
    });
    if (requeued.count === 0) {
      log.warn({ itemId, err: message }, 'agreement ingest error after the outcome was saved; not requeued');
      const done = await prisma.agreementIngestItem.findFirst({ where: { id: itemId, orgId }, select: { status: true } });
      return { status: (done?.status as ProcessOutcome['status'] | undefined) ?? 'skipped', itemId };
    }
    throw err;
  }
}

export { ITEM_FOR_PROCESS };
export type { ItemForProcess };
