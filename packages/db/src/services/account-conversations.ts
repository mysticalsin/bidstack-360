// Meetings and emails on one account, newest first, for the account page
// "Conversations" list. Same entity scope as the activity charts: the
// account, its opportunities and its contacts. Ordering uses the timestamp
// the list displays (a meeting's start, otherwise when it occurred) so a
// meeting logged today for an older start does not jump ahead of a newer one.

import {
  ACCOUNT_CONVERSATIONS_PAGE,
  COMMS_SOURCE_LABEL,
  CommsSource,
  type AccountConversation,
  type AccountConversations,
} from '@bidstack/shared';

import { Prisma } from '../../generated/client/index.js';
import { prisma } from '../index.js';

import type { CommsCaptureMeta } from './comms-activity.js';

const PAGE = 1000;

/** The timestamp the conversation list shows and pages by. */
export function conversationInstant(row: { startTime: Date | null; occurredAt: Date }): Date {
  return row.startTime ?? row.occurredAt;
}

/**
 * Newest displayed time first. Same-time rows use id descending, matching the
 * SQL `id < cursor` tie-break (Postgres uuid order, not text order).
 */
export function compareConversationRecency(
  a: { id: string; startTime: Date | null; occurredAt: Date },
  b: { id: string; startTime: Date | null; occurredAt: Date },
): number {
  return conversationInstant(b).getTime() - conversationInstant(a).getTime();
}

export function encodeConversationCursor(row: { occurredAt: Date; id: string }): string {
  return Buffer.from(`${row.occurredAt.toISOString()}|${row.id}`).toString('base64url');
}

function decodeConversationCursor(cursor: string): { at: Date; id: string } | null {
  const [iso, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  const at = new Date(iso ?? '');
  if (!id || Number.isNaN(at.getTime())) return null;
  return { at, id };
}

function captureOf(metadata: unknown): CommsCaptureMeta | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const meta = (metadata as { commsCapture?: unknown }).commsCapture;
  if (!meta || typeof meta !== 'object') return null;
  return CommsSource.safeParse((meta as { source?: unknown }).source).success ? (meta as CommsCaptureMeta) : null;
}

function ingestSourceOf(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const source = (metadata as { externalSource?: unknown }).externalSource;
  return typeof source === 'string' && source.trim() ? source.trim() : null;
}

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Display order for the page query. Kept in one place so the cursor matches it. */
export const CONVERSATION_ORDER_SQL = 'COALESCE(start_time, occurred_at)';

export function buildConversationIdQuery(input: {
  orgId: string;
  companyId: string;
  opportunityIds: string[];
  contactIds: string[];
  cursor: { at: Date; id: string } | null;
  take: number;
}): Prisma.Sql {
  const orderInstant = () => Prisma.raw(CONVERSATION_ORDER_SQL);
  const entities: Prisma.Sql[] = [
    Prisma.sql`(entity_type = 'company' AND entity_id = ${input.companyId}::uuid)`,
  ];
  if (input.opportunityIds.length > 0) {
    entities.push(
      Prisma.sql`(entity_type = 'opportunity' AND entity_id IN (${Prisma.join(
        input.opportunityIds.map((id) => Prisma.sql`${id}::uuid`),
      )}))`,
    );
  }
  if (input.contactIds.length > 0) {
    entities.push(
      Prisma.sql`(entity_type = 'contact' AND entity_id IN (${Prisma.join(
        input.contactIds.map((id) => Prisma.sql`${id}::uuid`),
      )}))`,
    );
  }
  const cursorSql = input.cursor
    ? Prisma.sql`AND (
        ${orderInstant()} < ${input.cursor.at}
        OR (${orderInstant()} = ${input.cursor.at} AND id < ${input.cursor.id}::uuid)
      )`
    : Prisma.empty;
  // Raw SQL skips the soft-delete middleware, so deleted_at is filtered here.
  return Prisma.sql`
    SELECT id
    FROM activities
    WHERE org_id = ${input.orgId}::uuid
      AND deleted_at IS NULL
      AND type::text IN ('meeting', 'email')
      AND (${Prisma.join(entities, ' OR ')})
      ${cursorSql}
    ORDER BY ${orderInstant()} DESC, id DESC
    LIMIT ${input.take}
  `;
}

export async function listAccountConversations(input: {
  orgId: string;
  companyId: string;
  viewerUserId: string;
  cursor?: string;
  limit?: number;
  now?: Date;
  /**
   * Opportunity filter for this viewer. The route passes the access-scope
   * predicate so a group-restricted user does not see hidden deals, their
   * names, or the meetings filed on them.
   */
  opportunityWhere?: Prisma.OpportunityWhereInput;
}): Promise<AccountConversations> {
  const { orgId, companyId } = input;
  const limit = Math.min(Math.max(1, input.limit ?? ACCOUNT_CONVERSATIONS_PAGE), 100);
  const now = input.now ?? new Date();

  const [opportunities, contacts] = await Promise.all([
    prisma.opportunity.findMany({
      where: input.opportunityWhere ?? { orgId, companyId, deletedAt: null },
      select: { id: true, name: true, stage: true },
      orderBy: { updatedAt: 'desc' },
      take: PAGE,
    }),
    prisma.contact.findMany({
      where: { orgId, companyId, deletedAt: null },
      select: { id: true },
      take: PAGE,
    }),
  ]);
  const oppName = new Map(opportunities.map((o) => [o.id, o.name]));
  const cursor = input.cursor ? decodeConversationCursor(input.cursor) : null;
  const orderedIds = await prisma.$queryRaw<Array<{ id: string }>>(
    buildConversationIdQuery({
      orgId,
      companyId,
      opportunityIds: opportunities.map((o) => o.id),
      contactIds: contacts.map((c) => c.id),
      cursor,
      take: limit + 1,
    }),
  );
  const found = orderedIds.length
    ? await prisma.activity.findMany({
        where: { orgId, deletedAt: null, id: { in: orderedIds.map((row) => row.id) } },
        select: {
          id: true,
          type: true,
          subject: true,
          status: true,
          occurredAt: true,
          startTime: true,
          endTime: true,
          entityType: true,
          entityId: true,
          metadata: true,
          body: true,
          _count: { select: { attendees: { where: { deletedAt: null } } } },
        },
        take: orderedIds.length,
      })
    : [];
  const byId = new Map(found.map((row) => [row.id, row]));
  const rows = orderedIds.flatMap((row) => {
    const hit = byId.get(row.id);
    return hit ? [hit] : [];
  });

  const page = rows.slice(0, limit);
  const items: AccountConversation[] = page.map((row) => {
    const capture = captureOf(row.metadata);
    const ingest = ingestSourceOf(row.metadata);
    const occurredAt = conversationInstant(row);
    const status =
      row.status === 'cancelled'
        ? 'cancelled'
        : row.type === 'meeting' && occurredAt.getTime() > now.getTime()
          ? 'planned'
          : row.status === 'planned'
            ? 'planned'
            : 'completed';
    const bodyDirection = (row.body as { direction?: unknown } | null)?.direction;
    const opportunityId = row.entityType === 'opportunity' ? row.entityId : null;
    return {
      id: row.id,
      type: row.type as 'meeting' | 'email',
      subject: row.subject?.trim() || (row.type === 'meeting' ? '(No title)' : '(No subject)'),
      occurredAt: occurredAt.toISOString(),
      endAt: row.endTime?.toISOString() ?? null,
      status,
      direction:
        capture?.direction ??
        (bodyDirection === 'inbound' || bodyDirection === 'outbound' ? bodyDirection : null),
      participantCount: capture?.participantCount ?? row._count.attendees,
      source: capture?.source ?? null,
      sourceLabel: capture ? COMMS_SOURCE_LABEL[capture.source] : ingest ? capitalise(ingest) : 'Logged in Polo',
      channel: capture?.channel ?? null,
      filing: capture ? (capture.filedManually ? 'manual' : 'automatic') : null,
      needsOpportunity: Boolean(capture?.needsOpportunity) && !opportunityId,
      opportunity: opportunityId ? { id: opportunityId, name: oppName.get(opportunityId) ?? 'Opportunity' } : null,
      sourceRecord: capture ? { kind: capture.sourceType, id: capture.sourceId } : null,
      canRefile: capture?.sourceType === 'calendar_event' && capture.ownerUserId === input.viewerUserId,
    };
  });

  const last = page[page.length - 1];
  return {
    companyId,
    items,
    nextCursor:
      orderedIds.length > limit && last
        ? encodeConversationCursor({ occurredAt: conversationInstant(last), id: last.id })
        : null,
    openOpportunities: opportunities
      .filter((o) => o.stage !== 'closed_won' && o.stage !== 'closed_lost')
      .map((o) => ({ id: o.id, name: o.name })),
  };
}
