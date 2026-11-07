// Stage one inbound agreement document (slice 13a). Shared by the REST route
// (POST /api/v1/ingest/agreements) and the MCP write tool agreements_ingest,
// so both channels dedupe, scope and audit the same way.
//
// Staging only records the document: the API's ingest processor fetches URL
// content through the SSRF guard, checks the file type from its bytes, runs
// the MSA intake extraction and leaves a draft for human review.
import { createHash } from 'node:crypto';

import {
  AGREEMENT_INGEST_INLINE_MAX_BYTES,
  type AgreementIngestChannel,
  type AgreementIngestItem,
  type AgreementIngestRequest,
} from '@bidstack/shared';

import type { Prisma } from '../../generated/client/index.js';
import { prisma } from '../index.js';

export type IngestActor =
  | { kind: 'user'; userId: string }
  | { kind: 'api_key'; keyId: string };

export interface StageAgreementInput {
  orgId: string;
  channel: Extract<AgreementIngestChannel, 'rest' | 'mcp'>;
  actor: IngestActor;
  /** null = unrestricted; otherwise metadata.companyId must be in the list. */
  companyScope: string[] | null;
  idempotencyKey?: string | null;
  request: AgreementIngestRequest;
}

export class AgreementStageError extends Error {
  constructor(
    message: string,
    readonly code: 'too_large' | 'bad_base64' | 'out_of_scope',
  ) {
    super(message);
    this.name = 'AgreementStageError';
  }
}

type ItemRow = {
  id: string;
  channel: string;
  externalSource: string;
  externalId: string;
  fileName: string;
  status: string;
  error: string | null;
  intakeDraftId: string | null;
  contractId: string | null;
  contractFileVersionId: string | null;
  metadata: unknown;
  createdAt: Date;
  processedAt: Date | null;
};

export const INGEST_ITEM_SELECT = {
  id: true,
  channel: true,
  externalSource: true,
  externalId: true,
  fileName: true,
  status: true,
  error: true,
  intakeDraftId: true,
  contractId: true,
  contractFileVersionId: true,
  metadata: true,
  createdAt: true,
  processedAt: true,
} as const;

export function serializeIngestItem(row: ItemRow): AgreementIngestItem {
  const meta = (row.metadata ?? {}) as { duplicateOf?: unknown };
  return {
    id: row.id,
    channel: row.channel as AgreementIngestItem['channel'],
    externalSource: row.externalSource,
    externalId: row.externalId,
    fileName: row.fileName,
    status: row.status as AgreementIngestItem['status'],
    error: row.error,
    duplicateOf: typeof meta.duplicateOf === 'string' ? meta.duplicateOf : null,
    intakeDraftId: row.intakeDraftId,
    contractId: row.contractId,
    contractFileVersionId: row.contractFileVersionId,
    createdAt: row.createdAt.toISOString(),
    processedAt: row.processedAt?.toISOString() ?? null,
  };
}

function decodeBase64(value: string): Buffer {
  const compact = value.replace(/\s+/g, '');
  if (compact.length % 4 !== 0) throw new AgreementStageError('file.base64 is not valid base64', 'bad_base64');
  const buf = Buffer.from(compact, 'base64');
  if (buf.length === 0) throw new AgreementStageError('file.base64 is empty', 'bad_base64');
  return buf;
}

function actorFields(actor: IngestActor) {
  return actor.kind === 'user'
    ? { actorType: 'user', actorId: actor.userId }
    : { actorType: 'api_key', actorId: actor.keyId };
}

export interface StageAgreementResult {
  item: AgreementIngestItem;
  /** False when an earlier item answered this call (idempotent replay or same bytes). */
  created: boolean;
}

/**
 * Record an inbound agreement. Dedupe, in order:
 *  1. same idempotency key: return the earlier item;
 *  2. same externalSource + externalId + sha256 (inline bytes): return the
 *     earlier item, nothing new is queued.
 * URL items get their sha256 at processing time and dedupe there.
 */
export async function stageAgreementIngest(input: StageAgreementInput): Promise<StageAgreementResult> {
  const { orgId, request } = input;
  const companyId = request.metadata?.companyId;
  if (input.companyScope && companyId && !input.companyScope.includes(companyId)) {
    throw new AgreementStageError('metadata.companyId is outside this key scope', 'out_of_scope');
  }
  if (input.companyScope && !companyId) {
    throw new AgreementStageError('A scoped key must name metadata.companyId', 'out_of_scope');
  }

  if (input.idempotencyKey) {
    const prior = await prisma.agreementIngestItem.findFirst({
      where: { orgId, idempotencyKey: input.idempotencyKey },
      select: INGEST_ITEM_SELECT,
    });
    if (prior) return { item: serializeIngestItem(prior), created: false };
  }

  let content: Buffer | null = null;
  let sha256: string | null = null;
  if ('base64' in request.file) {
    content = decodeBase64(request.file.base64);
    if (content.length > AGREEMENT_INGEST_INLINE_MAX_BYTES) {
      throw new AgreementStageError('Inline files are capped at 7 MB; send a url instead', 'too_large');
    }
    sha256 = createHash('sha256').update(content).digest('hex');
    const same = await prisma.agreementIngestItem.findFirst({
      where: {
        orgId,
        externalSource: request.externalSource,
        externalId: request.externalId,
        sha256,
        status: { notIn: ['failed', 'rejected'] },
      },
      orderBy: { createdAt: 'asc' },
      select: INGEST_ITEM_SELECT,
    });
    if (same) return { item: serializeIngestItem(same), created: false };
  }

  const metadata = { ...(request.metadata ?? {}) } as Prisma.InputJsonValue;
  const row = await prisma.agreementIngestItem
    .create({
    data: {
      orgId,
      channel: input.channel,
      externalSource: request.externalSource,
      externalId: request.externalId,
      idempotencyKey: input.idempotencyKey ?? null,
      fileName: request.fileName,
      contentType: request.contentType ?? null,
      bytes: content?.length ?? null,
      sha256,
      fileUrl: 'url' in request.file ? request.file.url : null,
      pendingContent: content,
      metadata,
      status: 'queued',
      ...actorFields(input.actor),
    },
    select: INGEST_ITEM_SELECT,
    })
    .catch(async (err: unknown) => {
      // A concurrent call with the same idempotency key won the insert.
      if ((err as { code?: string }).code === 'P2002' && input.idempotencyKey) {
        const winner = await prisma.agreementIngestItem.findFirst({
          where: { orgId, idempotencyKey: input.idempotencyKey },
          select: INGEST_ITEM_SELECT,
        });
        if (winner) return { ...winner, replay: true as const };
      }
      throw err;
    });
  if ('replay' in row) return { item: serializeIngestItem(row), created: false };
  await prisma.auditLog.create({
    data: {
      orgId,
      userId: input.actor.kind === 'user' ? input.actor.userId : null,
      action: 'agreement.ingest.received',
      targetType: 'agreement_ingest_item',
      targetId: row.id,
      diff: {
        channel: input.channel,
        externalSource: request.externalSource,
        externalId: request.externalId,
        fileName: request.fileName,
        mode: content ? 'inline' : 'url',
        ...(input.actor.kind === 'api_key' ? { apiKeyId: input.actor.keyId } : {}),
      },
    },
  });
  return { item: serializeIngestItem(row), created: true };
}
