/**
 * Teams chat import (slice 26): the picker behind the account page "Import
 * from Teams" sheet.
 *
 * Read-only. Every Graph call is a GET on the caller's own grant (Chat.Read,
 * plus ChannelMessage.Read.All where an admin approved it). Polo never posts
 * to Teams. A grant without the permission, or a Graph 403, becomes a
 * TeamsAccessError the route turns into a reconnect prompt, never an empty
 * list.
 */
import {
  IntegrationProvider,
  TeamsConsentError,
  createTeamsGraphClient,
  fileTeamsMessages,
  filedTeamsMessageIds,
  loadTeamsThread,
  prisma,
  runAccountActivityBatch,
  suggestTeamsAccounts,
  teamsThreadKey,
  teamsThreadTitle,
  type Prisma,
  type TeamsGraphClient,
} from '@bidstack/db';
import {
  TEAMS_CHANNEL_SCOPES,
  TEAMS_CHAT_SCOPES,
  grantsTeamsChannelRead,
  grantsTeamsChatRead,
  type TeamsAccess,
  type TeamsChatSummary,
  type TeamsImportRequest,
  type TeamsImportResult,
  type TeamsSyncLink,
  type TeamsThreadMessages,
  type TeamsThreadRef,
} from '@bidstack/shared';

import { getAccessToken, type ServiceLogger } from './email-integration.helpers.js';
import { isWorkspaceConfigured } from './workspace-connect.service.js';

/** Why Teams cannot be read right now; the route maps it to a 409 with this code. */
export class TeamsAccessError extends Error {
  constructor(
    readonly code: 'teams_not_connected' | 'teams_consent_required' | 'teams_channels_not_approved',
    message: string,
  ) {
    super(message);
  }
}

/** Server setting: an admin approved ChannelMessage.Read.All for this tenant. */
export function channelsAdminConsented(): boolean {
  return process.env.MICROSOFT_TEAMS_CHANNELS_ADMIN_CONSENTED === 'true';
}

/** Scopes for the "Reconnect with Teams access" consent. */
export function teamsConnectScopes(): string[] {
  return [...TEAMS_CHAT_SCOPES, ...(channelsAdminConsented() ? TEAMS_CHANNEL_SCOPES : [])];
}

const TOKEN_SELECT = {
  id: true,
  orgId: true,
  status: true,
  scope: true,
  accessTokenEncrypted: true,
  refreshTokenEncrypted: true,
  expiresAt: true,
  externalAccountEmail: true,
} as const;

async function grantRow(orgId: string, userId: string) {
  return prisma.integrationToken.findFirst({
    where: { orgId, userId, provider: IntegrationProvider.microsoft_graph, deletedAt: null },
    select: TOKEN_SELECT,
  });
}

export async function getTeamsAccess(orgId: string, userId: string): Promise<TeamsAccess> {
  if (!isWorkspaceConfigured('microsoft')) {
    return { state: 'not_configured', channels: 'needs_admin_consent', accountEmail: null };
  }
  const row = await grantRow(orgId, userId);
  const channels: TeamsAccess['channels'] = !channelsAdminConsented()
    ? 'needs_admin_consent'
    : row && grantsTeamsChannelRead(row.scope)
      ? 'ready'
      : 'needs_consent';
  if (!row || (row.status !== 'active' && row.scope.length === 0)) {
    return { state: 'not_connected', channels, accountEmail: null };
  }
  if (row.status !== 'active') return { state: 'revoked', channels, accountEmail: row.externalAccountEmail };
  return {
    state: grantsTeamsChatRead(row.scope) ? 'ready' : 'needs_consent',
    channels,
    accountEmail: row.externalAccountEmail,
  };
}

export interface TeamsSession {
  client: TeamsGraphClient;
  tokenId: string;
  ownerEmail: string | null;
}

/** A Graph client on the caller's grant, or a TeamsAccessError naming the fix. */
export async function openTeamsSession(
  orgId: string,
  userId: string,
  log: ServiceLogger,
  opts: { channels?: boolean; fetchImpl?: typeof fetch } = {},
): Promise<TeamsSession> {
  const row = await grantRow(orgId, userId);
  if (!row || row.status !== 'active') {
    throw new TeamsAccessError('teams_not_connected', 'Connect Microsoft 365 to import Teams chats.');
  }
  if (!grantsTeamsChatRead(row.scope)) {
    throw new TeamsAccessError(
      'teams_consent_required',
      'Polo needs permission to read your Teams chats. Reconnect Microsoft 365 and accept the Teams permission.',
    );
  }
  if (opts.channels && !channelsAdminConsented()) {
    throw new TeamsAccessError(
      'teams_channels_not_approved',
      'Channel threads need an admin to approve Teams channel access.',
    );
  }
  if (opts.channels && !grantsTeamsChannelRead(row.scope)) {
    throw new TeamsAccessError(
      'teams_consent_required',
      'Polo needs permission to read your Teams channels. Reconnect Microsoft 365 and accept the Teams permission.',
    );
  }
  const token = await getAccessToken({ ...row, provider: 'microsoft_graph' }, log);
  return {
    client: createTeamsGraphClient(token, opts.fetchImpl),
    tokenId: row.id,
    ownerEmail: row.externalAccountEmail?.toLowerCase() ?? null,
  };
}

/** Run a Graph read; a Graph 403 means the consent is missing or was withdrawn. */
export async function graphRead<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof TeamsConsentError) {
      throw new TeamsAccessError(
        'teams_consent_required',
        'Microsoft refused to share this Teams conversation. Reconnect Microsoft 365 and accept the Teams permission.',
      );
    }
    throw err;
  }
}

async function syncLinksByKey(orgId: string, userId: string, keys: string[]): Promise<Map<string, string>> {
  if (!keys.length) return new Map();
  const rows = await prisma.teamsChatLink.findMany({
    where: { orgId, userId, deletedAt: null, keepSyncing: true, threadKey: { in: keys } },
    select: { id: true, threadKey: true },
    take: keys.length,
  });
  return new Map(rows.map((r) => [r.threadKey, r.id]));
}

export async function listTeamsChats(
  orgId: string,
  userId: string,
  session: TeamsSession,
): Promise<TeamsChatSummary[]> {
  const chats = await graphRead(() => session.client.listChats(50));
  const refs = chats.map((c) => ({ kind: 'chat' as const, chatId: c.id }));
  const links = await syncLinksByKey(orgId, userId, refs.map(teamsThreadKey));
  return chats.map((chat, i) => ({
    ref: refs[i]!,
    title: teamsThreadTitle(chat.topic, chat.members, session.ownerEmail),
    subtitle: chat.chatType === 'oneOnOne' ? 'One to one' : chat.chatType === 'meeting' ? 'Meeting chat' : 'Group chat',
    memberCount: chat.members.length,
    lastActivityAt: chat.lastActivityAt,
    webUrl: chat.webUrl,
    syncLinkId: links.get(teamsThreadKey(refs[i]!)) ?? null,
  }));
}

export async function listTeamsChannelThreads(
  orgId: string,
  userId: string,
  session: TeamsSession,
  teamId: string,
  channelId: string,
): Promise<TeamsChatSummary[]> {
  const roots = (await graphRead(() => session.client.listChannelThreads(teamId, channelId, 20))).filter(
    (m) => m.messageType === 'message' && !m.deletedAt,
  );
  const refs = roots.map((m) => ({ kind: 'channel_thread' as const, teamId, channelId, messageId: m.id }));
  const links = await syncLinksByKey(orgId, userId, refs.map(teamsThreadKey));
  return roots.map((m, i) => ({
    ref: refs[i]!,
    title: (m.text.split('\n')[0] || 'Channel thread').slice(0, 300),
    subtitle: m.authorName,
    memberCount: 0,
    lastActivityAt: m.lastModifiedAt,
    webUrl: m.webUrl,
    syncLinkId: links.get(teamsThreadKey(refs[i]!)) ?? null,
  }));
}

function readThread(session: TeamsSession, ref: TeamsThreadRef) {
  return graphRead(() => loadTeamsThread(session.client, ref, { ownerEmail: session.ownerEmail }));
}

export async function previewTeamsThread(
  orgId: string,
  session: TeamsSession,
  ref: TeamsThreadRef,
  companyWhere: Prisma.CompanyWhereInput,
): Promise<TeamsThreadMessages> {
  const thread = await readThread(session, ref);
  const shown = thread.messages.filter((m) => m.messageType === 'message' && !m.deletedAt);
  const filed = await filedTeamsMessageIds(
    orgId,
    shown.map((m) => m.id),
  );
  const suggestions = await suggestTeamsAccounts({
    orgId,
    ownerEmail: session.ownerEmail,
    emails: thread.members.map((m) => m.email),
    companyWhere,
  });
  return {
    title: thread.title,
    participantCount: thread.members.length,
    items: shown.map((m) => ({
      id: m.id,
      authorName: m.authorName,
      createdAt: new Date(m.createdAt).toISOString(),
      preview: m.text.slice(0, 500),
      attachmentNames: m.attachmentNames,
      webUrl: m.webUrl,
      filed: filed.has(m.id),
    })),
    suggestions,
  };
}

function refColumns(ref: TeamsThreadRef) {
  return ref.kind === 'chat'
    ? { kind: 'chat', chatId: ref.chatId, teamId: null, channelId: null, rootMessageId: null }
    : { kind: 'channel_thread', chatId: null, teamId: ref.teamId, channelId: ref.channelId, rootMessageId: ref.messageId };
}

/** Later of two watermarks; the sync link never moves backwards. */
function laterOf(a: Date | null | undefined, b: Date | null | undefined): Date | null {
  if (!a) return b ?? null;
  if (!b) return a;
  return a > b ? a : b;
}

export async function importTeamsMessages(input: {
  orgId: string;
  userId: string;
  session: TeamsSession;
  request: TeamsImportRequest;
}): Promise<TeamsImportResult> {
  const { orgId, userId, session, request } = input;
  const thread = await readThread(session, request.ref);
  const wanted = new Set(request.messageIds);
  const picked = thread.messages.filter((m) => wanted.has(m.id));

  const filed = await runAccountActivityBatch(() =>
    fileTeamsMessages({
      orgId,
      ownerUserId: userId,
      ownerEmail: session.ownerEmail,
      actorUserId: userId,
      companyId: request.companyId,
      opportunityId: request.opportunityId ?? null,
      thread: { ref: request.ref, title: thread.title, members: thread.members },
      messages: picked,
    }),
  );

  const threadKey = teamsThreadKey(request.ref);
  // Everything read now is either filed or deliberately left out, so the
  // sync only picks up what changes after this import.
  const seen = thread.messages.reduce<Date | null>((max, m) => laterOf(max, new Date(m.lastModifiedAt)), null);
  const existing = await prisma.teamsChatLink.findFirst({
    where: { orgId, userId, threadKey },
    select: { id: true, watermark: true },
  });
  let syncLinkId: string | null = null;
  if (existing) {
    await prisma.teamsChatLink.updateMany({
      where: { id: existing.id, orgId, userId },
      data: {
        keepSyncing: request.keepSyncing,
        companyId: request.companyId,
        opportunityId: request.opportunityId ?? null,
        integrationTokenId: session.tokenId,
        title: thread.title,
        watermark: laterOf(existing.watermark, seen),
        lastError: null,
      },
    });
    syncLinkId = request.keepSyncing ? existing.id : null;
  } else if (request.keepSyncing) {
    const created = await prisma.teamsChatLink.create({
      data: {
        orgId,
        userId,
        integrationTokenId: session.tokenId,
        threadKey,
        ...refColumns(request.ref),
        title: thread.title,
        webUrl: request.ref.kind === 'chat' ? null : (thread.messages[0]?.webUrl ?? null),
        companyId: request.companyId,
        opportunityId: request.opportunityId ?? null,
        keepSyncing: true,
        watermark: seen,
        lastSyncedAt: new Date(),
      },
      select: { id: true },
    });
    syncLinkId = created.id;
  }

  return {
    created: filed.created,
    updated: filed.updated,
    skipped: filed.skipped + (request.messageIds.length - picked.length),
    alreadyFiled: filed.alreadyFiled,
    syncLinkId,
  };
}

function refOf(row: {
  kind: string;
  chatId: string | null;
  teamId: string | null;
  channelId: string | null;
  rootMessageId: string | null;
}): TeamsThreadRef {
  return row.kind === 'chat'
    ? { kind: 'chat', chatId: row.chatId ?? '' }
    : {
        kind: 'channel_thread',
        teamId: row.teamId ?? '',
        channelId: row.channelId ?? '',
        messageId: row.rootMessageId ?? '',
      };
}

export async function listTeamsSyncLinks(
  orgId: string,
  userId: string,
  companyWhere: Prisma.CompanyWhereInput,
  companyId?: string,
): Promise<TeamsSyncLink[]> {
  const rows = await prisma.teamsChatLink.findMany({
    where: { orgId, userId, deletedAt: null, keepSyncing: true, ...(companyId ? { companyId } : {}) },
    orderBy: { updatedAt: 'desc' },
    take: 100,
  });
  if (!rows.length) return [];
  const companies = await prisma.company.findMany({
    where: { AND: [companyWhere, { orgId, deletedAt: null, id: { in: [...new Set(rows.map((r) => r.companyId))] } }] },
    select: { id: true, name: true },
    take: rows.length,
  });
  const nameOf = new Map(companies.map((c) => [c.id, c.name]));
  return rows
    .filter((r) => nameOf.has(r.companyId))
    .map((r) => ({
      id: r.id,
      ref: refOf(r),
      title: r.title || 'Teams chat',
      companyId: r.companyId,
      companyName: nameOf.get(r.companyId) ?? 'Account',
      keepSyncing: r.keepSyncing,
      lastSyncedAt: r.lastSyncedAt?.toISOString() ?? null,
      lastError: r.lastError,
    }));
}

/** Turn ongoing sync off (or back on) for one of the caller's own links. */
export async function setTeamsSyncLink(
  orgId: string,
  userId: string,
  linkId: string,
  keepSyncing: boolean,
): Promise<boolean> {
  const res = await prisma.teamsChatLink.updateMany({
    where: { id: linkId, orgId, userId, deletedAt: null },
    data: { keepSyncing, ...(keepSyncing ? { lastError: null } : {}) },
  });
  return res.count > 0;
}
