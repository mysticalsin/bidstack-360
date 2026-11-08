// Account events (slice 21): one call per thing that happened on an account.
// Fans out an in-app alert to everyone who follows the account (team members,
// key account owner, opp owners, explicit followers; minus muted, minus the
// actor), coalesces repeats into one row per account per window, and queues
// email or Teams copies per the recipient's channel prefs.
//
// Recipients are Polo users only; this never messages customer contacts.
// Callers fire and forget (emitAccountEventSafe); an alert failure must never
// fail the write that caused it.
import { prisma } from '@bidstack/db';
import {
  ACCOUNT_ALERT_IN_APP_HOURLY_LIMIT,
  ACCOUNT_ALERT_COALESCE_MS,
  accountGroupKey,
  alertBody,
  coalescedTitle,
  computeAccountAudience,
  groupForAccountEvent,
  resolveChannelGroups,
  shouldCoalesce,
  type AccountEventKind,
} from '@bidstack/shared';

import { applyCompanyScope, getAccessScope } from '../lib/access-scope.js';
import { createLogger } from '../lib/logger.js';
import { enqueueExternalCopies, publishNotification } from './notification.service.js';

const log = createLogger({ name: 'account-events' });

export interface AccountEventInput {
  orgId: string;
  companyId: string;
  kind: AccountEventKind;
  actorUserId: string | null;
  entityType: string;
  entityId: string;
  /** Full alert title, e.g. "New meeting on Pfizer", or built from the company name. */
  title: string | ((companyName: string) => string);
  /** In-app path (or absolute URL) to the item; defaults to the company page. */
  sourceUrl?: string | null;
  /** Users already told about this event through another notification. */
  excludeUserIds?: string[];
  /** How many underlying events this call stands for (batched ingest). */
  weight?: number;
}

export interface AccountEventResult {
  recipients: number;
  created: number;
  coalesced: number;
  skipped: number;
}

const EMPTY: AccountEventResult = { recipients: 0, created: 0, coalesced: 0, skipped: 0 };

export function companyPath(companyId: string): string {
  return `/companies/${companyId}`;
}

/** Users who follow the account, before the actor, mute and access filters. */
export async function loadAccountFollowers(orgId: string, companyId: string, today = new Date()) {
  const company = await prisma.company.findFirst({
    where: { id: companyId, orgId, deletedAt: null },
    select: { id: true, name: true, keyAccountOwnerId: true },
  });
  if (!company) return null;
  const day = new Date(today.toISOString().slice(0, 10));
  const [team, opps, follows] = await Promise.all([
    prisma.accountTeamMember.findMany({
      where: { orgId, companyId, OR: [{ endDate: null }, { endDate: { gte: day } }] },
      select: { userId: true },
      take: 200,
    }),
    prisma.opportunity.findMany({
      where: { orgId, companyId, deletedAt: null },
      select: { ownerId: true },
      distinct: ['ownerId'],
      take: 200,
    }),
    prisma.accountFollow.findMany({
      where: { orgId, companyId },
      select: { userId: true, muted: true },
      take: 500,
    }),
  ]);
  return {
    company,
    teamUserIds: team.map((t) => t.userId),
    opportunityOwnerIds: opps.map((o) => o.ownerId),
    follows,
  };
}

async function canSeeCompany(orgId: string, userId: string, companyId: string): Promise<boolean> {
  const scope = await getAccessScope(orgId, userId);
  if (scope.unrestricted) return true;
  const n = await prisma.company.count({
    where: applyCompanyScope({ id: companyId, orgId, deletedAt: null }, scope),
  });
  return n > 0;
}

export async function emitAccountEvent(
  input: AccountEventInput,
  now = new Date(),
): Promise<AccountEventResult> {
  const followers = await loadAccountFollowers(input.orgId, input.companyId, now);
  if (!followers) return EMPTY;
  const audience = computeAccountAudience({
    actorUserId: input.actorUserId,
    keyAccountOwnerId: followers.company.keyAccountOwnerId,
    teamUserIds: followers.teamUserIds,
    opportunityOwnerIds: followers.opportunityOwnerIds,
    follows: followers.follows,
  }).filter((id) => !input.excludeUserIds?.includes(id));
  if (audience.length === 0) return EMPTY;

  const [users, prefs, actor] = await Promise.all([
    prisma.user.findMany({
      where: { orgId: input.orgId, id: { in: audience }, deletedAt: null },
      select: { id: true },
      take: audience.length,
    }),
    prisma.notificationPref.findMany({
      where: { orgId: input.orgId, userId: { in: audience } },
      select: { userId: true, channelPrefs: true, teamsWebhookEnc: true },
      take: audience.length,
    }),
    input.actorUserId
      ? prisma.user.findFirst({
          where: { id: input.actorUserId, orgId: input.orgId },
          select: { name: true, email: true },
        })
      : Promise.resolve(null),
  ]);
  const prefByUser = new Map(prefs.map((p) => [p.userId, p]));
  const actorName = actor ? (actor.name ?? actor.email) : null;
  const group = groupForAccountEvent(input.kind);
  const groupKey = accountGroupKey(input.companyId);
  const itemUrl = input.sourceUrl ?? companyPath(input.companyId);
  const title =
    typeof input.title === 'function' ? input.title(followers.company.name) : input.title;
  const body = alertBody(actorName, title);
  const result: AccountEventResult = {
    recipients: users.length,
    created: 0,
    coalesced: 0,
    skipped: 0,
  };

  for (const { id: userId } of users) {
    try {
      if (!(await canSeeCompany(input.orgId, userId, input.companyId))) {
        result.skipped++;
        continue;
      }
      const pref = prefByUser.get(userId) ?? null;
      const toggles = resolveChannelGroups(pref?.channelPrefs)[group];
      let notificationId: string | null = null;
      if (toggles.in_app) {
        const outcome = await writeInAppAlert({
          orgId: input.orgId,
          userId,
          groupKey,
          companyId: input.companyId,
          companyName: followers.company.name,
          title,
          body,
          url: itemUrl,
          entityType: input.entityType,
          entityId: input.entityId,
          actorUserId: input.actorUserId,
          weight: Math.max(1, input.weight ?? 1),
          now,
        });
        notificationId = outcome.id;
        result[outcome.kind]++;
      } else {
        result.skipped++;
      }
      await enqueueExternalCopies({
        orgId: input.orgId,
        userId,
        toggles,
        pref,
        notificationId,
        companyId: input.companyId,
        title,
        body,
        url: itemUrl,
      });
    } catch (err) {
      result.skipped++;
      log.warn(
        { err, orgId: input.orgId, userId, kind: input.kind },
        'account alert for one user failed',
      );
    }
  }
  return result;
}

interface InAppAlertInput {
  orgId: string;
  userId: string;
  groupKey: string;
  companyId: string;
  companyName: string;
  title: string;
  body: string;
  url: string;
  entityType: string;
  entityId: string;
  actorUserId: string | null;
  weight: number;
  now: Date;
}

async function writeInAppAlert(
  a: InAppAlertInput,
): Promise<{ kind: 'created' | 'coalesced' | 'skipped'; id: string | null }> {
  const existing = await prisma.notification.findFirst({
    where: {
      orgId: a.orgId,
      userId: a.userId,
      groupKey: a.groupKey,
      readAt: null,
      lastEventAt: { gte: new Date(a.now.getTime() - ACCOUNT_ALERT_COALESCE_MS) },
    },
    orderBy: { lastEventAt: 'desc' },
    select: { id: true, eventCount: true, lastEventAt: true },
  });
  if (existing && shouldCoalesce(existing.lastEventAt, a.now)) {
    const count = existing.eventCount + a.weight;
    const title = coalescedTitle(count, a.companyName);
    await prisma.notification.updateMany({
      where: { id: existing.id, orgId: a.orgId, userId: a.userId },
      data: {
        eventCount: count,
        title,
        body: a.body,
        url: companyPath(a.companyId),
        entityType: 'company',
        entityId: a.companyId,
        actorUserId: a.actorUserId,
        lastEventAt: a.now,
      },
    });
    publishNotification(a.userId, {
      id: existing.id,
      type: 'account_activity',
      title,
      body: a.body,
      url: companyPath(a.companyId),
      count,
    });
    return { kind: 'coalesced', id: existing.id };
  }

  const recent = await prisma.notification.count({
    where: {
      orgId: a.orgId,
      userId: a.userId,
      type: 'account_activity',
      createdAt: { gte: new Date(a.now.getTime() - 60 * 60_000) },
    },
  });
  if (recent >= ACCOUNT_ALERT_IN_APP_HOURLY_LIMIT) {
    log.info(
      { orgId: a.orgId, userId: a.userId },
      'account alert rate limit reached; in-app alert skipped',
    );
    return { kind: 'skipped', id: null };
  }

  const row = await prisma.notification.create({
    data: {
      orgId: a.orgId,
      userId: a.userId,
      type: 'account_activity',
      title: a.title,
      body: a.body,
      entityType: a.entityType,
      entityId: a.entityId,
      url: a.url,
      groupKey: a.groupKey,
      eventCount: a.weight,
      lastEventAt: a.now,
      actorUserId: a.actorUserId,
    },
  });
  publishNotification(a.userId, {
    id: row.id,
    type: 'account_activity',
    title: row.title,
    body: row.body,
    url: row.url,
    count: a.weight,
  });
  return { kind: 'created', id: row.id };
}

/** Fire and forget from a route: logs, never throws, never delays the response. */
export function emitAccountEventSafe(input: AccountEventInput): void {
  void emitAccountEvent(input).catch((err) =>
    log.warn(
      { err, orgId: input.orgId, companyId: input.companyId, kind: input.kind },
      'emitAccountEvent failed',
    ),
  );
}

/** Resolve the company of an opportunity and emit; no-op when the opp has no company. */
export async function emitOpportunityAccountEvent(
  input: Omit<AccountEventInput, 'companyId' | 'title'> & {
    opportunityId: string;
    title: (names: { companyName: string; opportunityName: string }) => string;
  },
): Promise<void> {
  const opp = await prisma.opportunity.findFirst({
    where: { id: input.opportunityId, orgId: input.orgId },
    select: { name: true, companyId: true, company: { select: { name: true } } },
  });
  if (!opp?.companyId || !opp.company) return;
  const { opportunityId: _o, title, ...rest } = input;
  await emitAccountEvent({
    ...rest,
    companyId: opp.companyId,
    title: title({ companyName: opp.company.name, opportunityName: opp.name }),
  });
}

const ACTIVITY_LABEL: Record<string, string> = {
  meeting: 'New meeting',
  call: 'New call',
  email: 'New email',
  note: 'New note',
  task: 'New task',
};

/** Only person-to-person activity is alert-worthy; system timeline rows are not. */
const ALERTABLE_ACTIVITY_TYPES = new Set(Object.keys(ACTIVITY_LABEL));

/**
 * Activities logged manually or ingested (Dust, CRMs, MCP). Resolves each
 * activity to its account (company, opportunity or contact parent) and emits
 * one event per account; a batch on one account becomes one counted alert.
 */
export function emitActivitiesAccountEventsSafe(input: {
  orgId: string;
  activityIds: string[];
  actorUserId: string | null;
}): void {
  if (input.activityIds.length === 0) return;
  void (async () => {
    const rows = await prisma.activity.findMany({
      where: { orgId: input.orgId, id: { in: input.activityIds.slice(0, 500) }, deletedAt: null },
      select: { id: true, type: true, entityType: true, entityId: true },
      take: 500,
    });
    const alertable = rows.filter((r) => ALERTABLE_ACTIVITY_TYPES.has(r.type));
    if (alertable.length === 0) return;
    const ids = (t: string) => alertable.filter((r) => r.entityType === t).map((r) => r.entityId);
    const [opps, contacts] = await Promise.all([
      prisma.opportunity.findMany({
        where: { orgId: input.orgId, id: { in: ids('opportunity') } },
        select: { id: true, companyId: true },
        take: 500,
      }),
      prisma.contact.findMany({
        where: { orgId: input.orgId, id: { in: ids('contact') } },
        select: { id: true, companyId: true },
        take: 500,
      }),
    ]);
    const parent = new Map<string, string | null>([
      ...opps.map((o) => [o.id, o.companyId] as const),
      ...contacts.map((c) => [c.id, c.companyId] as const),
    ]);
    const byCompany = new Map<string, typeof alertable>();
    for (const r of alertable) {
      const companyId = r.entityType === 'company' ? r.entityId : (parent.get(r.entityId) ?? null);
      if (!companyId) continue;
      byCompany.set(companyId, [...(byCompany.get(companyId) ?? []), r]);
    }
    for (const [companyId, items] of byCompany) {
      const first = items[0]!;
      const label = ACTIVITY_LABEL[first.type] ?? 'New activity';
      await emitAccountEvent({
        orgId: input.orgId,
        companyId,
        kind: 'activity_logged',
        actorUserId: input.actorUserId,
        entityType: 'activity',
        entityId: first.id,
        title: (company) =>
          items.length > 1
            ? `${items.length} new activities on ${company}`
            : `${label} on ${company}`,
        weight: items.length,
      });
    }
  })().catch((err) => log.warn({ err, orgId: input.orgId }, 'activity account events failed'));
}

/** Task on an account (accountId) or on one of its opportunities. */
export function emitTaskAccountEventSafe(input: {
  orgId: string;
  taskId: string;
  kind: 'task_created' | 'task_completed';
  actorUserId: string | null;
}): void {
  void (async () => {
    const task = await prisma.task.findFirst({
      where: { id: input.taskId, orgId: input.orgId },
      select: {
        title: true,
        accountId: true,
        oppId: true,
        opportunity: { select: { companyId: true } },
      },
    });
    const companyId = task?.accountId ?? task?.opportunity?.companyId ?? null;
    if (!task || !companyId) return;
    const verb = input.kind === 'task_created' ? 'New task' : 'Task completed';
    await emitAccountEvent({
      orgId: input.orgId,
      companyId,
      kind: input.kind,
      actorUserId: input.actorUserId,
      entityType: 'task',
      entityId: input.taskId,
      title: (company) => `${verb} on ${company}: ${task.title}`,
      sourceUrl: `/tasks/${input.taskId}`,
    });
  })().catch((err) =>
    log.warn(
      { err, orgId: input.orgId, taskId: input.taskId, kind: input.kind },
      'emitAccountEvent failed',
    ),
  );
}

export function emitOpportunityAccountEventSafe(
  input: Parameters<typeof emitOpportunityAccountEvent>[0],
): void {
  void emitOpportunityAccountEvent(input).catch((err) =>
    log.warn(
      { err, orgId: input.orgId, opportunityId: input.opportunityId, kind: input.kind },
      'emitAccountEvent failed',
    ),
  );
}
