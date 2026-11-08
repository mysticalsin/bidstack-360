/**
 * Teams chat import (slice 26). Read-only: every Graph call is a GET on the
 * caller's own Microsoft 365 grant. Polo never posts to Teams.
 *
 *   GET   /integrations/teams/access                          what the grant allows
 *   POST  /integrations/teams/connect                         consent URL with Teams read scopes
 *   GET   /integrations/teams/chats                           recent chats
 *   GET   /integrations/teams/teams                           joined teams (admin-approved tenants)
 *   GET   /integrations/teams/teams/:teamId/channels          channels of a team
 *   GET   /integrations/teams/teams/:teamId/channels/:channelId/threads
 *   GET   /integrations/teams/messages                        messages of one chat or thread, with account suggestions
 *   POST  /integrations/teams/import                          file chosen messages to an account
 *   GET   /integrations/teams/links                           the caller's synced chats
 *   PATCH /integrations/teams/links/:id                       turn sync off or on
 *
 * A missing permission is a 409 with a code (teams_consent_required,
 * teams_not_connected, teams_channels_not_approved) so the sheet shows a
 * reconnect prompt. Not 403: the web client treats 403 as a session problem.
 */
import type { FastifyReply } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { TeamsNotFoundError, TeamsThrottledError, prisma } from '@bidstack/db';
import {
  TeamsAccess,
  TeamsChatList,
  TeamsImportRequest,
  TeamsImportResult,
  TeamsSyncLinks,
  TeamsThreadMessages,
  type TeamsThreadRef,
} from '@bidstack/shared';

import { applyCompanyScope, applyOpportunityScope, getAccessScope } from '../../lib/access-scope.js';
import {
  NotConfigured,
  WorkspaceNotConfiguredError,
  buildConnectUrl,
  notConfiguredBody,
} from '../../services/workspace-connect.service.js';
import {
  TeamsAccessError,
  getTeamsAccess,
  graphRead,
  importTeamsMessages,
  listTeamsChannelThreads,
  listTeamsChats,
  listTeamsSyncLinks,
  openTeamsSession,
  previewTeamsThread,
  setTeamsSyncLink,
  teamsConnectScopes,
} from '../../services/teams-import.service.js';

const AccessProblem = z.object({ statusCode: z.literal(409), code: z.string(), message: z.string() });
const Throttled = z.object({ statusCode: z.literal(429), message: z.string() });
const Missing = z.object({ statusCode: z.literal(404), message: z.string() });

const GraphId = z.string().min(1).max(300);
const ThreadQuery = z.object({
  kind: z.enum(['chat', 'channel_thread']),
  chatId: GraphId.optional(),
  teamId: GraphId.optional(),
  channelId: GraphId.optional(),
  messageId: GraphId.optional(),
});

function refFromQuery(q: z.infer<typeof ThreadQuery>): TeamsThreadRef | null {
  if (q.kind === 'chat') return q.chatId ? { kind: 'chat', chatId: q.chatId } : null;
  return q.teamId && q.channelId && q.messageId
    ? { kind: 'channel_thread', teamId: q.teamId, channelId: q.channelId, messageId: q.messageId }
    : null;
}

export const teamsImportRoutes: FastifyPluginAsyncZod = async (server) => {
  /** Shared error mapping: consent to 409, throttling to 429, gone to 404. */
  async function guarded<T>(reply: FastifyReply, fn: () => Promise<T>): Promise<T | undefined> {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof TeamsAccessError) {
        await reply.status(409).send({ statusCode: 409, code: err.code, message: err.message });
        return undefined;
      }
      if (err instanceof TeamsThrottledError) {
        await reply.status(429).send({ statusCode: 429, message: 'Microsoft Teams is busy. Try again in a minute.' });
        return undefined;
      }
      if (err instanceof TeamsNotFoundError) {
        await reply.status(404).send({ statusCode: 404, message: 'That Teams conversation is not available to you.' });
        return undefined;
      }
      throw err;
    }
  }

  server.get(
    '/integrations/teams/access',
    {
      config: { permission: 'activities:read' },
      schema: { tags: ['Integrations'], summary: 'What the Microsoft 365 grant allows for Teams import', response: { 200: TeamsAccess } },
    },
    async (req) => getTeamsAccess(req.auth.orgId, req.auth.userId),
  );

  server.post(
    '/integrations/teams/connect',
    {
      config: { permission: 'activities:write', rateLimit: { max: 20, timeWindow: '1 minute' } },
      schema: {
        tags: ['Integrations'],
        summary: 'Consent URL that adds read-only Teams scopes to the Microsoft 365 grant',
        body: z.object({}).strict().nullish(),
        response: { 200: z.object({ authUrl: z.string().url() }), 503: NotConfigured },
      },
    },
    async (req, reply) => {
      try {
        const authUrl = await buildConnectUrl('microsoft', req.auth.orgId, req.auth.userId, {
          extraScopes: teamsConnectScopes(),
        });
        return reply.send({ authUrl });
      } catch (err) {
        if (err instanceof WorkspaceNotConfiguredError) return reply.status(503).send(notConfiguredBody(err));
        throw err;
      }
    },
  );

  server.get(
    '/integrations/teams/chats',
    {
      config: { permission: 'activities:read', rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: {
        tags: ['Integrations'],
        summary: 'Recent Teams chats of the caller (read-only)',
        response: { 200: TeamsChatList, 404: Missing, 409: AccessProblem, 429: Throttled },
      },
    },
    async (req, reply) =>
      guarded(reply, async () => {
        const { orgId, userId } = req.auth;
        const session = await openTeamsSession(orgId, userId, req.log);
        return { items: await listTeamsChats(orgId, userId, session) };
      }),
  );

  server.get(
    '/integrations/teams/teams',
    {
      config: { permission: 'activities:read', rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: {
        tags: ['Integrations'],
        summary: 'Teams the caller joined',
        response: {
          200: z.object({ items: z.array(z.object({ id: z.string(), displayName: z.string() })) }),
          404: Missing,
          409: AccessProblem,
          429: Throttled,
        },
      },
    },
    async (req, reply) =>
      guarded(reply, async () => {
        const session = await openTeamsSession(req.auth.orgId, req.auth.userId, req.log, { channels: true });
        return { items: await graphRead(() => session.client.listJoinedTeams()) };
      }),
  );

  server.get(
    '/integrations/teams/teams/:teamId/channels',
    {
      config: { permission: 'activities:read', rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: {
        tags: ['Integrations'],
        summary: 'Channels of one joined team',
        params: z.object({ teamId: GraphId }),
        response: {
          200: z.object({ items: z.array(z.object({ id: z.string(), displayName: z.string() })) }),
          404: Missing,
          409: AccessProblem,
          429: Throttled,
        },
      },
    },
    async (req, reply) =>
      guarded(reply, async () => {
        const session = await openTeamsSession(req.auth.orgId, req.auth.userId, req.log, { channels: true });
        return { items: await graphRead(() => session.client.listChannels(req.params.teamId)) };
      }),
  );

  server.get(
    '/integrations/teams/teams/:teamId/channels/:channelId/threads',
    {
      config: { permission: 'activities:read', rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: {
        tags: ['Integrations'],
        summary: 'Recent threads in one channel',
        params: z.object({ teamId: GraphId, channelId: GraphId }),
        response: { 200: TeamsChatList, 404: Missing, 409: AccessProblem, 429: Throttled },
      },
    },
    async (req, reply) =>
      guarded(reply, async () => {
        const { orgId, userId } = req.auth;
        const session = await openTeamsSession(orgId, userId, req.log, { channels: true });
        return {
          items: await listTeamsChannelThreads(orgId, userId, session, req.params.teamId, req.params.channelId),
        };
      }),
  );

  server.get(
    '/integrations/teams/messages',
    {
      config: { permission: 'activities:read', rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: {
        tags: ['Integrations'],
        summary: 'Messages of one chat or channel thread, with suggested accounts',
        querystring: ThreadQuery,
        response: { 200: TeamsThreadMessages, 404: Missing, 409: AccessProblem, 429: Throttled },
      },
    },
    async (req, reply) => {
      const ref = refFromQuery(req.query);
      if (!ref) throw server.httpErrors.badRequest('Incomplete Teams conversation reference');
      return guarded(reply, async () => {
        const { orgId, userId } = req.auth;
        const session = await openTeamsSession(orgId, userId, req.log, { channels: ref.kind === 'channel_thread' });
        const scope = await getAccessScope(orgId, userId);
        return previewTeamsThread(orgId, session, ref, applyCompanyScope({ orgId, deletedAt: null }, scope));
      });
    },
  );

  server.post(
    '/integrations/teams/import',
    {
      config: { permission: 'activities:write', rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        tags: ['Integrations'],
        summary: 'File chosen Teams messages to an account; optionally keep syncing the chat',
        body: TeamsImportRequest,
        response: { 200: TeamsImportResult, 404: Missing, 409: AccessProblem, 429: Throttled },
      },
    },
    async (req, reply) => {
      const { orgId, userId } = req.auth;
      const body = req.body;
      const scope = await getAccessScope(orgId, userId);
      const company = await prisma.company.findFirst({
        where: applyCompanyScope({ id: body.companyId, orgId, deletedAt: null }, scope),
        select: { id: true },
      });
      if (!company) throw server.httpErrors.notFound('Company not found');
      if (body.opportunityId) {
        const opp = await prisma.opportunity.findFirst({
          where: applyOpportunityScope({ id: body.opportunityId, orgId, companyId: company.id, deletedAt: null }, scope),
          select: { id: true },
        });
        if (!opp) throw server.httpErrors.notFound('Opportunity not found on this account');
      }
      if (!body.messageIds.length && !body.keepSyncing) {
        throw server.httpErrors.badRequest('Pick at least one message or turn on sync');
      }
      return guarded(reply, async () => {
        const session = await openTeamsSession(orgId, userId, req.log, {
          channels: body.ref.kind === 'channel_thread',
        });
        return importTeamsMessages({ orgId, userId, session, request: body });
      });
    },
  );

  server.get(
    '/integrations/teams/links',
    {
      config: { permission: 'activities:read' },
      schema: {
        tags: ['Integrations'],
        summary: 'Teams chats the caller keeps syncing to accounts',
        querystring: z.object({ companyId: z.string().uuid().optional() }),
        response: { 200: TeamsSyncLinks },
      },
    },
    async (req) => {
      const { orgId, userId } = req.auth;
      const scope = await getAccessScope(orgId, userId);
      return {
        items: await listTeamsSyncLinks(
          orgId,
          userId,
          applyCompanyScope({ orgId, deletedAt: null }, scope),
          req.query.companyId,
        ),
      };
    },
  );

  server.patch(
    '/integrations/teams/links/:id',
    {
      config: { permission: 'activities:write' },
      schema: {
        tags: ['Integrations'],
        summary: 'Turn ongoing sync off or on for one of your synced chats',
        params: z.object({ id: z.string().uuid() }),
        body: z.object({ keepSyncing: z.boolean() }).strict(),
        response: { 204: z.null() },
      },
    },
    async (req, reply) => {
      const ok = await setTeamsSyncLink(req.auth.orgId, req.auth.userId, req.params.id, req.body.keepSyncing);
      if (!ok) throw server.httpErrors.notFound('Synced chat not found');
      return reply.status(204).send(null);
    },
  );
};
