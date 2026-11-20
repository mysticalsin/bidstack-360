// In-app notification center — list, unread count, mark-read. Per-user +
// org-scoped (a user only ever sees their own notifications).
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { prisma, type Prisma } from '@bidstack/db';
import {
  DEFAULT_NOTIFICATION_PREFS,
  Notification,
  NotificationChannelPrefs,
  NotificationChannelSettings,
  NotificationPage,
  NotificationPrefs,
  TeamsWebhookInput,
  TeamsWebhookTestResult,
  absoluteAppUrl,
  buildTeamsAdaptiveCard,
  isAllowedTeamsWebhookUrl,
  postTeamsCard,
  resolveChannelGroups,
  type NotificationType,
  QueryBoolean,
} from '@bidstack/shared';
import { decryptSecret, encryptSecret } from '@bidstack/shared/server-crypto';

interface DbRow {
  id: string;
  type: string;
  title: string;
  body: string | null;
  entityType: string | null;
  entityId: string | null;
  url: string | null;
  readAt: Date | null;
  createdAt: Date;
}

function serialize(r: DbRow): z.infer<typeof Notification> {
  return {
    id: r.id,
    type: r.type as NotificationType,
    title: r.title,
    body: r.body,
    entityType: r.entityType,
    entityId: r.entityId,
    url: r.url,
    readAt: r.readAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  };
}

const IdParam = z.object({ id: z.string().uuid() });

export const notificationsRoutes: FastifyPluginAsyncZod = async (server) => {
  server.get(
    '/notifications',
    {
      schema: {
        querystring: z.object({ unreadOnly: QueryBoolean.optional() }),
        response: { 200: NotificationPage },
      },
    },
    async (req) => {
      const where = {
        orgId: req.auth.orgId,
        userId: req.auth.userId,
        ...(req.query.unreadOnly ? { readAt: null } : {}),
      };
      const [items, unread] = await Promise.all([
        prisma.notification.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          take: 30,
        }),
        prisma.notification.count({
          where: { orgId: req.auth.orgId, userId: req.auth.userId, readAt: null },
        }),
      ]);
      return { items: items.map(serialize), unread };
    },
  );

  server.patch(
    '/notifications/:id/read',
    { schema: { params: IdParam, response: { 200: Notification } } },
    async (req) => {
      // updateMany keeps the write org+user scoped — a user can only mark their
      // own notification read.
      const result = await prisma.notification.updateMany({
        where: { id: req.params.id, orgId: req.auth.orgId, userId: req.auth.userId },
        data: { readAt: new Date() },
      });
      if (result.count === 0) throw server.httpErrors.notFound('Notification not found');
      const row = await prisma.notification.findFirstOrThrow({
        where: { id: req.params.id, orgId: req.auth.orgId, userId: req.auth.userId },
      });
      return serialize(row);
    },
  );

  server.post(
    '/notifications/read-all',
    { schema: { response: { 200: z.object({ updated: z.number().int().nonnegative() }) } } },
    async (req) => {
      const result = await prisma.notification.updateMany({
        where: { orgId: req.auth.orgId, userId: req.auth.userId, readAt: null },
        data: { readAt: new Date() },
      });
      return { updated: result.count };
    },
  );

  // ── Per-user notification preferences ──────────────────────────────────────
  // Replaces the old localStorage-only toggles. One row per user; absent row =
  // defaults. mentionPush/dealStageChange are enforced in createNotification.
  server.get(
    '/notifications/prefs',
    { schema: { response: { 200: NotificationPrefs } } },
    async (req) => {
      const row = await prisma.notificationPref.findUnique({
        where: { userId: req.auth.userId },
      });
      if (!row) return DEFAULT_NOTIFICATION_PREFS;
      return {
        emailDigest: row.emailDigest,
        mentionPush: row.mentionPush,
        taskDueSoon: row.taskDueSoon,
        dealStageChange: row.dealStageChange,
      };
    },
  );

  server.put(
    '/notifications/prefs',
    { schema: { body: NotificationPrefs, response: { 200: NotificationPrefs } } },
    async (req) => {
      const { emailDigest, mentionPush, taskDueSoon, dealStageChange } = req.body;
      const row = await prisma.notificationPref.upsert({
        where: { userId: req.auth.userId },
        create: {
          orgId: req.auth.orgId,
          userId: req.auth.userId,
          emailDigest,
          mentionPush,
          taskDueSoon,
          dealStageChange,
        },
        update: { emailDigest, mentionPush, taskDueSoon, dealStageChange },
      });
      return {
        emailDigest: row.emailDigest,
        mentionPush: row.mentionPush,
        taskDueSoon: row.taskDueSoon,
        dealStageChange: row.dealStageChange,
      };
    },
  );

  // ── Per kind group, per channel delivery + Teams webhook ───────────────────
  async function channelSettings(userId: string): Promise<z.infer<typeof NotificationChannelSettings>> {
    const row = await prisma.notificationPref.findUnique({
      where: { userId },
      select: { channelPrefs: true, accountDigestDaily: true, teamsWebhookEnc: true, teamsWebhookHost: true },
    });
    return {
      groups: resolveChannelGroups(row?.channelPrefs),
      dailyDigest: row?.accountDigestDaily ?? false,
      teamsWebhook: { configured: !!row?.teamsWebhookEnc, host: row?.teamsWebhookHost ?? null },
    };
  }

  server.get(
    '/notifications/channels',
    { schema: { response: { 200: NotificationChannelSettings } } },
    async (req) => channelSettings(req.auth.userId),
  );

  server.put(
    '/notifications/channels',
    { schema: { body: NotificationChannelPrefs, response: { 200: NotificationChannelSettings } } },
    async (req) => {
      const channelPrefs = { groups: req.body.groups } as unknown as Prisma.InputJsonValue;
      await prisma.notificationPref.upsert({
        where: { userId: req.auth.userId },
        create: {
          orgId: req.auth.orgId,
          userId: req.auth.userId,
          ...DEFAULT_NOTIFICATION_PREFS,
          channelPrefs,
          accountDigestDaily: req.body.dailyDigest,
        },
        update: { channelPrefs, accountDigestDaily: req.body.dailyDigest },
      });
      return channelSettings(req.auth.userId);
    },
  );

  server.put(
    '/notifications/teams-webhook',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: { body: TeamsWebhookInput, response: { 200: NotificationChannelSettings } },
    },
    async (req) => {
      const url = req.body.url;
      if (!isAllowedTeamsWebhookUrl(url)) {
        throw server.httpErrors.badRequest(
          'Paste the https webhook URL from a Microsoft Teams Workflows flow (logic.azure.com, powerplatform.com or webhook.office.com).',
        );
      }
      let enc: string;
      try {
        enc = encryptSecret(url);
      } catch {
        throw server.httpErrors.serviceUnavailable('Teams delivery is not configured on this server yet.');
      }
      const host = new URL(url).hostname.toLowerCase();
      await prisma.notificationPref.upsert({
        where: { userId: req.auth.userId },
        create: {
          orgId: req.auth.orgId,
          userId: req.auth.userId,
          ...DEFAULT_NOTIFICATION_PREFS,
          teamsWebhookEnc: enc,
          teamsWebhookHost: host,
        },
        update: { teamsWebhookEnc: enc, teamsWebhookHost: host },
      });
      await prisma.auditLog.create({
        data: {
          orgId: req.auth.orgId,
          userId: req.auth.userId,
          action: 'notification.teams_webhook.set',
          targetType: 'user',
          targetId: req.auth.userId,
          diff: { host } as Prisma.InputJsonValue,
        },
      });
      return channelSettings(req.auth.userId);
    },
  );

  server.delete(
    '/notifications/teams-webhook',
    { schema: { response: { 200: NotificationChannelSettings } } },
    async (req) => {
      await prisma.notificationPref.updateMany({
        where: { userId: req.auth.userId, orgId: req.auth.orgId },
        data: { teamsWebhookEnc: null, teamsWebhookHost: null },
      });
      await prisma.auditLog.create({
        data: {
          orgId: req.auth.orgId,
          userId: req.auth.userId,
          action: 'notification.teams_webhook.clear',
          targetType: 'user',
          targetId: req.auth.userId,
        },
      });
      return channelSettings(req.auth.userId);
    },
  );

  server.post(
    '/notifications/teams-webhook/test',
    {
      config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
      schema: { body: z.object({}).strict().nullish(), response: { 200: TeamsWebhookTestResult } },
    },
    async (req) => {
      const row = await prisma.notificationPref.findUnique({
        where: { userId: req.auth.userId },
        select: { teamsWebhookEnc: true },
      });
      if (!row?.teamsWebhookEnc) {
        return { ok: false, status: null, message: 'Add a Teams webhook URL first.' };
      }
      let url: string;
      try {
        url = decryptSecret(row.teamsWebhookEnc);
      } catch {
        return { ok: false, status: null, message: 'The saved webhook could not be read. Paste it again.' };
      }
      const card = buildTeamsAdaptiveCard({
        title: 'Polo test alert',
        body: 'Account alerts will show up here.',
        url: absoluteAppUrl(process.env.PUBLIC_BASE_URL ?? 'http://localhost:5173', '/settings'),
      });
      const res = await teamsPoster(url, card);
      if (res.ok) return { ok: true, status: res.status, message: 'Test card sent to Teams.' };
      req.log.warn({ status: res.status, reason: res.reason }, 'teams webhook test failed');
      return {
        ok: false,
        status: res.status,
        message: res.status ? `Teams answered ${res.status}. Check the workflow is on.` : 'Teams could not be reached.',
      };
    },
  );
};

type TeamsPoster = (url: string, card: Record<string, unknown>) => ReturnType<typeof postTeamsCard>;
let teamsPoster: TeamsPoster = (url, card) => postTeamsCard(url, card);

/** Tests swap the HTTP call for a fake. Pass null to reset. */
export function __setTeamsPosterForTest(fn: TeamsPoster | null): void {
  teamsPoster = fn ?? ((url, card) => postTeamsCard(url, card));
}
