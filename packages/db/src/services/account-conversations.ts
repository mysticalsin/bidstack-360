// Meetings and emails on one account, newest first, for the account page
// "Conversations" list. Same entity scope as the activity charts: the
// account, its opportunities and its contacts.

import {
  ACCOUNT_CONVERSATIONS_PAGE,
  COMMS_SOURCE_LABEL,
  CommsSource,
  type AccountConversation,
  type AccountConversations,
} from '@bidstack/shared';

import type { Prisma } from '../../generated/client/index.js';
import { prisma } from '../index.js';

import type { CommsCaptureMeta } from './comms-activity.js';

const PAGE = 1000;

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

export async function listAccountConversations(input: {
  orgId: string;
  companyId: string;
  viewerUserId: string;
  cursor?: string;
  limit?: number;
  now?: Date;
}): Promise<AccountConversations> {
  const { orgId, companyId } = input;
  const limit = Math.min(Math.max(1, input.limit ?? ACCOUNT_CONVERSATIONS_PAGE), 100);
  const now = input.now ?? new Date();

  const [opportunities, contacts] = await Promise.all([
    prisma.opportunity.findMany({
      where: { orgId, companyId, deletedAt: null },
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
  const entityScope: Prisma.ActivityWhereInput[] = [
    { entityType: 'company', entityId: companyId },
    ...(opportunities.length
      ? [{ entityType: 'opportunity', entityId: { in: opportunities.map((o) => o.id) } }]
      : []),
    ...(contacts.length ? [{ entityType: 'contact', entityId: { in: contacts.map((c) => c.id) } }] : []),
  ];
  const cursor = input.cursor ? decodeConversationCursor(input.cursor) : null;

  const rows = await prisma.activity.findMany({
    where: {
      orgId,
      deletedAt: null,
      type: { in: ['meeting', 'email'] },
      AND: [
        { OR: entityScope },
        ...(cursor
          ? [{ OR: [{ occurredAt: { lt: cursor.at } }, { occurredAt: cursor.at, id: { lt: cursor.id } }] }]
          : []),
      ],
    },
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
    orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
  });

  const page = rows.slice(0, limit);
  const items: AccountConversation[] = page.map((row) => {
    const capture = captureOf(row.metadata);
    const ingest = ingestSourceOf(row.metadata);
    const occurredAt = row.startTime ?? row.occurredAt;
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
    nextCursor: rows.length > limit && last ? encodeConversationCursor(last) : null,
    openOpportunities: opportunities
      .filter((o) => o.stage !== 'closed_won' && o.stage !== 'closed_lost')
      .map((o) => ({ id: o.id, name: o.name })),
  };
}
