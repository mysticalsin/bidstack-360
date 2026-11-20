// Teams messages a person files to an account become account activities
// (slice 26). The API picker and the worker "keep syncing" pull both call
// fileTeamsMessages with messages already read from Graph (teams-graph.ts).
//
// Rules:
// - One activity per Graph message id per org: Activity.idempotencyKey is a
//   hash of org and message id, so a message filed twice, or by two people in
//   the same chat, lands once.
// - A message already filed to another account by someone else stays there
//   (alreadyFiled). The person who filed it can move it by filing it again.
// - Only real messages: system events (member added, call ended) are skipped.
//   A message deleted in Teams soft-deletes its activity (removedBy "sync").
// - A row a person deleted in Polo stays deleted on sync; an explicit import
//   by a person brings it back.
// - Plain text preview only (teams-graph.ts strips HTML), attachment names
//   only, never their content. Contact lookups pass orgId so the PII
//   middleware can match hashed contact emails.
// - Created rows raise onAccountActivityCreated; callers wrap a run in
//   runAccountActivityBatch so followers get one digest per account.

import { createHash } from 'node:crypto';

import { FREE_MAIL_DOMAINS, type TeamsAccountSuggestion, type TeamsThreadRef } from '@bidstack/shared';

import type { Prisma, PrismaClient } from '../../generated/client/index.js';
import { prisma } from '../index.js';

import { onAccountActivityCreated } from './account-activity-events.js';
import type { TeamsGraphClient, TeamsMember, TeamsMessage } from './teams-graph.js';

export type TeamsActivityDb = Pick<
  PrismaClient,
  'activity' | 'activityAttendee' | 'contact' | 'user' | 'company' | 'opportunity' | '$transaction'
>;

/** Stored on Activity.metadata.commsCapture, read by the Conversations list. */
export interface TeamsCaptureMeta {
  version: 1;
  kind: 'teams_message';
  provider: 'microsoft_graph';
  source: 'teams';
  channel: null;
  sourceType: 'teams_message';
  /** Graph chatMessage id. */
  sourceId: string;
  ownerUserId: string;
  companyId: string;
  opportunityId: string | null;
  contactId: null;
  filedManually: boolean;
  needsOpportunity: boolean;
  direction: 'inbound' | 'outbound' | null;
  participantCount: number;
  isPrivate: false;
  ownerDeclined: false;
  removedBy?: 'sync';
  teams: {
    thread: TeamsThreadRef;
    webUrl: string | null;
    authorName: string | null;
    attachmentNames: string[];
    replyToId: string | null;
  };
}

export interface FileTeamsMessagesInput {
  orgId: string;
  /** The person whose Teams access read the messages. */
  ownerUserId: string;
  ownerEmail: string | null;
  /** The person who chose to file (picker); null for the sync worker. */
  actorUserId: string | null;
  companyId: string;
  opportunityId: string | null;
  thread: { ref: TeamsThreadRef; title: string; members: TeamsMember[] };
  messages: TeamsMessage[];
}

export interface FileTeamsMessagesResult {
  created: number;
  updated: number;
  skipped: number;
  alreadyFiled: number;
  removed: number;
  activityIds: string[];
  /** Highest lastModifiedAt among the messages seen, for the sync watermark. */
  watermark: Date | null;
}

const KEY_PREFIX = 'teams:';
const MAX_PARTICIPANTS = 200;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Org-scoped dedupe key stored in Activity.idempotencyKey (VarChar 128). */
export function teamsActivityKey(orgId: string, graphMessageId: string): string {
  const digest = createHash('sha256').update(`${orgId}\u0000teams\u0000${graphMessageId}`).digest('hex');
  return `${KEY_PREFIX}${digest}`;
}

/** Stable key for a Teams thread, one TeamsChatLink row per person per key. */
export function teamsThreadKey(ref: TeamsThreadRef): string {
  return ref.kind === 'chat' ? `chat:${ref.chatId}` : `channel:${ref.teamId}:${ref.channelId}:${ref.messageId}`;
}

/** Chat topic, else member names without the owner, else a plain label. */
export function teamsThreadTitle(
  topic: string | null,
  members: TeamsMember[],
  ownerEmail: string | null,
): string {
  if (topic?.trim()) return topic.trim().slice(0, 300);
  const owner = ownerEmail?.toLowerCase() ?? '';
  const names = members
    .filter((m) => !owner || m.email !== owner)
    .map((m) => m.displayName?.trim())
    .filter((n): n is string => Boolean(n));
  if (!names.length) return 'Teams chat';
  const head = names.slice(0, 3).join(', ');
  return (names.length > 3 ? `Chat with ${head} and ${names.length - 3} more` : `Chat with ${head}`).slice(0, 300);
}

export interface LoadedTeamsThread {
  title: string;
  members: TeamsMember[];
  /** Oldest first. */
  messages: TeamsMessage[];
}

/**
 * Members and messages of one thread, read-only. A chat has a member list
 * with emails. A channel thread has no member read in the requested scopes,
 * so its participants are the authors, without emails. With `since`, only
 * messages changed after it.
 */
export async function loadTeamsThread(
  client: TeamsGraphClient,
  ref: TeamsThreadRef,
  opts: { ownerEmail: string | null; since?: Date | null },
): Promise<LoadedTeamsThread> {
  const byCreated = (a: TeamsMessage, b: TeamsMessage) => Date.parse(a.createdAt) - Date.parse(b.createdAt);
  if (ref.kind === 'chat') {
    const [chat, messages] = await Promise.all([
      client.getChat(ref.chatId),
      client.listChatMessages(ref.chatId, { since: opts.since ?? null, limit: 200 }),
    ]);
    return {
      title: teamsThreadTitle(chat.topic, chat.members, opts.ownerEmail),
      members: chat.members,
      messages: [...messages].sort(byCreated),
    };
  }
  const all = await client.listThreadMessages(ref.teamId, ref.channelId, ref.messageId);
  const authors = new Map<string, TeamsMember>();
  for (const m of all) {
    if (m.authorAadId && !authors.has(m.authorAadId)) {
      authors.set(m.authorAadId, { aadUserId: m.authorAadId, email: null, displayName: m.authorName });
    }
  }
  const root = all.find((m) => m.id === ref.messageId);
  const since = opts.since?.getTime();
  return {
    title: (root?.text.split('\n')[0] || 'Channel thread').slice(0, 300),
    members: [...authors.values()],
    messages: all.filter((m) => since === undefined || Date.parse(m.lastModifiedAt) > since).sort(byCreated),
  };
}

const domainOf = (email: string) => email.slice(email.lastIndexOf('@') + 1).toLowerCase();

function cleanEmails(raw: Array<string | null | undefined>): string[] {
  const out: string[] = [];
  for (const value of raw) {
    const email = (value ?? '').trim().toLowerCase();
    if (!EMAIL.test(email) || out.includes(email)) continue;
    out.push(email);
    if (out.length >= MAX_PARTICIPANTS) break;
  }
  return out;
}

function storedMeta(metadata: unknown): TeamsCaptureMeta | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const meta = (metadata as { commsCapture?: unknown }).commsCapture;
  return meta && typeof meta === 'object' && (meta as { kind?: unknown }).kind === 'teams_message'
    ? (meta as TeamsCaptureMeta)
    : null;
}

function candidateDomains(emails: string[]): string[] {
  const out = new Set<string>();
  for (const email of emails) {
    const d = domainOf(email);
    if (FREE_MAIL_DOMAINS.has(d)) continue;
    out.add(d);
    const labels = d.split('.');
    if (labels.length > 2) out.add(labels.slice(-2).join('.'));
  }
  return [...out];
}

export function createTeamsActivityService(db: TeamsActivityDb = prisma as unknown as TeamsActivityDb) {
  async function orgUsers(orgId: string): Promise<{ users: Map<string, string>; domains: Set<string> }> {
    const rows = await db.user.findMany({
      where: { orgId },
      select: { id: true, email: true, microsoftEmail: true },
      orderBy: { id: 'asc' },
      take: 1000,
    });
    const users = new Map<string, string>();
    const domains = new Set<string>();
    for (const row of rows) {
      for (const raw of [row.email, row.microsoftEmail]) {
        const email = (raw ?? '').trim().toLowerCase();
        if (!EMAIL.test(email)) continue;
        users.set(email, row.id);
        const d = domainOf(email);
        if (!FREE_MAIL_DOMAINS.has(d)) domains.add(d);
      }
    }
    return { users, domains };
  }

  async function needsOpportunity(orgId: string, companyId: string): Promise<boolean> {
    const open = await db.opportunity.findMany({
      where: { orgId, companyId, deletedAt: null, stage: { notIn: ['closed_won', 'closed_lost'] } },
      select: { id: true },
      take: 2,
    });
    return open.length > 1;
  }

  /**
   * Accounts the participants point at: a known contact first, then a
   * company domain. Org colleagues and free mail domains never match.
   * `companyWhere` carries the caller's access scope.
   */
  async function suggestAccounts(input: {
    orgId: string;
    ownerEmail: string | null;
    emails: Array<string | null>;
    companyWhere?: Prisma.CompanyWhereInput;
    limit?: number;
  }): Promise<TeamsAccountSuggestion[]> {
    const { orgId } = input;
    const limit = input.limit ?? 5;
    const dir = await orgUsers(orgId);
    const owner = input.ownerEmail?.toLowerCase() ?? '';
    if (owner && !FREE_MAIL_DOMAINS.has(domainOf(owner))) dir.domains.add(domainOf(owner));
    const externals = cleanEmails(input.emails).filter(
      (e) => e !== owner && !dir.users.has(e) && !dir.domains.has(domainOf(e)),
    );
    if (!externals.length) return [];

    const matches = new Map<string, { reason: 'contact' | 'domain'; match: string }>();
    const contacts = await db.contact.findMany({
      where: { orgId, deletedAt: null, email: { in: externals } },
      select: { email: true, companyId: true },
      take: MAX_PARTICIPANTS,
    });
    const rank = (email: string | null) => externals.indexOf((email ?? '').toLowerCase());
    for (const c of [...contacts].sort((a, b) => rank(a.email) - rank(b.email))) {
      if (c.companyId && !matches.has(c.companyId)) {
        matches.set(c.companyId, { reason: 'contact', match: (c.email ?? '').toLowerCase() });
      }
    }
    const domains = candidateDomains(externals);
    const byDomain = domains.length
      ? await db.company.findMany({
          where: { orgId, deletedAt: null, domain: { in: domains, mode: 'insensitive' } },
          select: { id: true, domain: true },
          take: 20,
        })
      : [];
    for (const c of byDomain) {
      if (!matches.has(c.id)) matches.set(c.id, { reason: 'domain', match: (c.domain ?? '').toLowerCase() });
    }
    if (!matches.size) return [];

    const visible = await db.company.findMany({
      where: { AND: [input.companyWhere ?? {}, { orgId, deletedAt: null, id: { in: [...matches.keys()] } }] },
      select: { id: true, name: true },
      take: matches.size,
    });
    const nameOf = new Map(visible.map((c) => [c.id, c.name]));
    return [...matches.entries()]
      .filter(([id]) => nameOf.has(id))
      .slice(0, limit)
      .map(([companyId, m]) => ({ companyId, name: nameOf.get(companyId) ?? 'Account', ...m }));
  }

  /** Graph message ids already filed (live) in this org. */
  async function filedMessageIds(orgId: string, graphMessageIds: string[]): Promise<Set<string>> {
    if (!graphMessageIds.length) return new Set();
    const keyOf = new Map(graphMessageIds.map((id) => [teamsActivityKey(orgId, id), id]));
    const rows = await db.activity.findMany({
      where: { orgId, deletedAt: null, idempotencyKey: { in: [...keyOf.keys()] } },
      select: { idempotencyKey: true },
      take: keyOf.size,
    });
    return new Set(rows.flatMap((r) => (r.idempotencyKey && keyOf.has(r.idempotencyKey) ? [keyOf.get(r.idempotencyKey)!] : [])));
  }

  async function fileMessages(input: FileTeamsMessagesInput): Promise<FileTeamsMessagesResult> {
    const { orgId, companyId, opportunityId } = input;
    const manual = input.actorUserId !== null;
    const result: FileTeamsMessagesResult = {
      created: 0,
      updated: 0,
      skipped: 0,
      alreadyFiled: 0,
      removed: 0,
      activityIds: [],
      watermark: null,
    };
    if (!input.messages.length) return result;

    const owner = input.ownerEmail?.toLowerCase() ?? null;
    const members = input.thread.members;
    const emailByAad = new Map(
      members.flatMap((m) => (m.aadUserId && m.email ? [[m.aadUserId, m.email.toLowerCase()] as const] : [])),
    );
    const participants = cleanEmails(members.map((m) => m.email));
    const dir = await orgUsers(orgId);
    const contacts = participants.length
      ? await db.contact.findMany({
          where: { orgId, deletedAt: null, email: { in: participants } },
          select: { id: true, email: true },
          take: MAX_PARTICIPANTS,
        })
      : [];
    const contactByEmail = new Map(contacts.map((c) => [(c.email ?? '').toLowerCase(), c.id]));
    const attendees = participants.map((email) => {
      const contactId = contactByEmail.get(email) ?? null;
      const userId = contactId ? null : (dir.users.get(email) ?? null);
      return { orgId, contactId, userId, email: contactId || userId ? null : email, responseStatus: 'accepted' };
    });
    const involved = [
      ...new Set([input.ownerUserId, ...attendees.flatMap((a) => (a.userId ? [a.userId] : []))]),
    ];
    const needsOpp = opportunityId ? false : await needsOpportunity(orgId, companyId);

    for (const msg of input.messages) {
      const modified = new Date(msg.lastModifiedAt);
      if (!Number.isNaN(modified.getTime()) && (!result.watermark || modified > result.watermark)) {
        result.watermark = modified;
      }
      const key = teamsActivityKey(orgId, msg.id);
      const live = await db.activity.findFirst({
        where: { orgId, idempotencyKey: key },
        select: { id: true, metadata: true },
      });
      const prior = storedMeta(live?.metadata);

      if (msg.deletedAt) {
        if (live) {
          await db.activity.updateMany({
            where: { id: live.id, orgId },
            data: {
              deletedAt: new Date(),
              description: null,
              metadata: { commsCapture: { ...prior, removedBy: 'sync' } } as unknown as Prisma.InputJsonObject,
            },
          });
          result.removed += 1;
        } else result.skipped += 1;
        continue;
      }
      if (msg.messageType !== 'message') {
        result.skipped += 1;
        continue;
      }

      if (live && prior && prior.companyId !== companyId) {
        const sameFiler = manual && prior.ownerUserId === input.ownerUserId;
        if (!sameFiler) {
          result.alreadyFiled += 1;
          continue;
        }
      }

      const tomb = live
        ? null
        : await db.activity.findFirst({
            where: { orgId, idempotencyKey: key, deletedAt: { not: null } },
            select: { id: true, metadata: true },
          });
      const tombMeta = storedMeta(tomb?.metadata);
      if (tomb && !manual && tombMeta?.removedBy !== 'sync') {
        result.skipped += 1;
        continue;
      }

      const authorEmail = msg.authorAadId ? (emailByAad.get(msg.authorAadId) ?? null) : null;
      const meta: TeamsCaptureMeta = {
        version: 1,
        kind: 'teams_message',
        provider: 'microsoft_graph',
        source: 'teams',
        channel: null,
        sourceType: 'teams_message',
        sourceId: msg.id,
        ownerUserId: prior && live && !manual ? prior.ownerUserId : input.ownerUserId,
        companyId,
        opportunityId,
        contactId: null,
        filedManually: manual || Boolean(prior?.filedManually),
        needsOpportunity: needsOpp,
        direction: authorEmail && owner ? (authorEmail === owner ? 'outbound' : 'inbound') : null,
        participantCount: participants.length || (msg.authorName ? 1 : 0),
        isPrivate: false,
        ownerDeclined: false,
        teams: {
          thread: input.thread.ref,
          webUrl: msg.webUrl,
          authorName: msg.authorName,
          attachmentNames: msg.attachmentNames,
          replyToId: msg.replyToId,
        },
      };
      const occurredAt = new Date(msg.createdAt);
      const data = {
        type: 'teams_message' as const,
        subject: input.thread.title.slice(0, 300),
        description: msg.text || (msg.attachmentNames.length ? `Attachments: ${msg.attachmentNames.join(', ')}` : null),
        startTime: null,
        endTime: null,
        status: 'completed' as const,
        entityType: opportunityId ? 'opportunity' : 'company',
        entityId: opportunityId ?? companyId,
        ownerId: meta.ownerUserId,
        actorId: manual ? input.actorUserId : null,
        actorType: manual ? ('user' as const) : ('system' as const),
        occurredAt: Number.isNaN(occurredAt.getTime()) ? new Date() : occurredAt,
        metadata: { commsCapture: meta } as unknown as Prisma.InputJsonObject,
      };
      const writeAttendees = async (tx: TeamsActivityDb, activityId: string) => {
        await tx.activityAttendee.deleteMany({ where: { orgId, activityId } });
        if (attendees.length) {
          await tx.activityAttendee.createMany({ data: attendees.map((a) => ({ ...a, activityId })) });
        }
      };

      if (live) {
        const { actorId: _actorId, actorType: _actorType, ...syncData } = data;
        await db.$transaction(async (tx) => {
          await tx.activity.updateMany({ where: { id: live.id, orgId }, data: manual ? data : syncData });
          await writeAttendees(tx as unknown as TeamsActivityDb, live.id);
        });
        result.updated += 1;
        result.activityIds.push(live.id);
        if (prior && prior.companyId !== companyId) {
          await onAccountActivityCreated(orgId, companyId, live.id, input.actorUserId, involved);
        }
        continue;
      }

      let activityId: string;
      try {
        activityId = await db.$transaction(async (tx) => {
          let id: string;
          if (tomb) {
            await tx.activity.updateMany({
              where: { id: tomb.id, orgId, deletedAt: { not: null } },
              data: { ...data, deletedAt: null },
            });
            id = tomb.id;
          } else {
            const created = await tx.activity.create({
              data: { ...data, orgId, idempotencyKey: key },
              select: { id: true },
            });
            id = created.id;
          }
          await writeAttendees(tx as unknown as TeamsActivityDb, id);
          return id;
        });
      } catch (err) {
        // A concurrent import of the same message created it first.
        if ((err as { code?: string }).code === 'P2002') {
          result.skipped += 1;
          continue;
        }
        throw err;
      }
      result.created += 1;
      result.activityIds.push(activityId);
      await onAccountActivityCreated(orgId, companyId, activityId, input.actorUserId, involved);
    }
    return result;
  }

  return { fileMessages, suggestAccounts, filedMessageIds };
}

let shared: ReturnType<typeof createTeamsActivityService> | null = null;

function service() {
  shared ??= createTeamsActivityService();
  return shared;
}

export function fileTeamsMessages(input: FileTeamsMessagesInput): Promise<FileTeamsMessagesResult> {
  return service().fileMessages(input);
}

export function suggestTeamsAccounts(
  input: Parameters<ReturnType<typeof createTeamsActivityService>['suggestAccounts']>[0],
): Promise<TeamsAccountSuggestion[]> {
  return service().suggestAccounts(input);
}

export function filedTeamsMessageIds(orgId: string, graphMessageIds: string[]): Promise<Set<string>> {
  return service().filedMessageIds(orgId, graphMessageIds);
}
