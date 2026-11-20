/**
 * Teams chat sync (slice 26): new messages in chats a person linked with
 * "keep syncing" are filed to the linked account.
 *
 *  teams.chat.fanout  every 10 minutes, one job per Microsoft grant with linked chats
 *  teams.chat.sync    read each linked thread since its watermark and file new messages
 *
 * Read-only Graph GETs on the person's own grant. Polo never posts to Teams.
 * Incremental: chats are read with $filter on lastModifiedDateTime after the
 * link's watermark; channel threads are re-read and filtered the same way.
 * One run per grant is one runAccountActivityBatch, so followers get one
 * digest per account. A missing permission is written to the link
 * (lastError consent_required), which the sheet shows as a reconnect prompt.
 */
import { DelayedError, Queue, Worker } from 'bullmq';
import type IORedis from 'ioredis';
import type pino from 'pino';

import {
  IntegrationProvider,
  TeamsConsentError,
  TeamsNotFoundError,
  TeamsThrottledError,
  createTeamsGraphClient,
  fileTeamsMessages,
  loadTeamsThread,
  prisma,
  runAccountActivityBatch,
} from '@bidstack/db';
import { TEAMS_CHAT_SYNC, grantsTeamsChannelRead, grantsTeamsChatRead, type TeamsChatSyncJob, type TeamsThreadRef } from '@bidstack/shared';

import { ProviderRateLimitError } from '../lib/provider-http.js';
import { GrantRevokedError, getWorkspaceAccessToken } from '../lib/workspace-token.js';

const LINKS_PER_RUN = 50;
const FANOUT_EVERY_MS = 10 * 60 * 1000;

type LinkError = 'consent_required' | 'not_found' | 'account_missing' | 'sync_failed';

export interface TeamsSyncDeps {
  db: typeof prisma;
  getToken: typeof getWorkspaceAccessToken;
  file: typeof fileTeamsMessages;
  fetchImpl?: typeof fetch;
}

const defaultDeps = (): TeamsSyncDeps => ({ db: prisma, getToken: getWorkspaceAccessToken, file: fileTeamsMessages });

function refOf(link: {
  kind: string;
  chatId: string | null;
  teamId: string | null;
  channelId: string | null;
  rootMessageId: string | null;
}): TeamsThreadRef | null {
  if (link.kind === 'chat') return link.chatId ? { kind: 'chat', chatId: link.chatId } : null;
  return link.teamId && link.channelId && link.rootMessageId
    ? { kind: 'channel_thread', teamId: link.teamId, channelId: link.channelId, messageId: link.rootMessageId }
    : null;
}

export interface TeamsSyncSummary {
  links: number;
  created: number;
  failed: number;
}

/** Sync every linked thread on one grant. Throttling becomes a ProviderRateLimitError. */
export async function syncTeamsLinksForToken(
  job: TeamsChatSyncJob,
  log: pino.Logger,
  deps: TeamsSyncDeps = defaultDeps(),
): Promise<TeamsSyncSummary> {
  const { db } = deps;
  const summary: TeamsSyncSummary = { links: 0, created: 0, failed: 0 };
  const token = await db.integrationToken.findFirst({
    where: {
      id: job.integrationTokenId,
      orgId: job.orgId,
      userId: job.userId,
      provider: IntegrationProvider.microsoft_graph,
      deletedAt: null,
    },
    select: {
      id: true,
      orgId: true,
      provider: true,
      status: true,
      scope: true,
      accessTokenEncrypted: true,
      refreshTokenEncrypted: true,
      expiresAt: true,
      externalAccountEmail: true,
    },
  });
  if (!token || token.status === 'revoked') return summary;

  const links = await db.teamsChatLink.findMany({
    where: { orgId: job.orgId, userId: job.userId, integrationTokenId: token.id, keepSyncing: true, deletedAt: null },
    orderBy: { lastSyncedAt: { sort: 'asc', nulls: 'first' } },
    take: LINKS_PER_RUN,
  });
  if (!links.length) return summary;

  const mark = (id: string, lastError: LinkError) =>
    db.teamsChatLink.updateMany({ where: { id, orgId: job.orgId }, data: { lastError, lastSyncedAt: new Date() } });

  if (!grantsTeamsChatRead(token.scope)) {
    for (const link of links) await mark(link.id, 'consent_required');
    log.warn({ tokenId: token.id, links: links.length }, 'teams sync: grant lacks Chat.Read; links marked for reconnect');
    return { ...summary, links: links.length, failed: links.length };
  }

  const access = await deps.getToken(token, log, deps.fetchImpl);
  const client = createTeamsGraphClient(access, deps.fetchImpl);
  const ownerEmail = token.externalAccountEmail?.toLowerCase() ?? null;

  await runAccountActivityBatch(async () => {
    for (const link of links) {
      summary.links += 1;
      const ref = refOf(link);
      if (!ref) {
        await mark(link.id, 'not_found');
        summary.failed += 1;
        continue;
      }
      if (ref.kind === 'channel_thread' && !grantsTeamsChannelRead(token.scope)) {
        await mark(link.id, 'consent_required');
        summary.failed += 1;
        continue;
      }
      const company = await db.company.findFirst({
        where: { id: link.companyId, orgId: job.orgId, deletedAt: null },
        select: { id: true },
      });
      if (!company) {
        await mark(link.id, 'account_missing');
        summary.failed += 1;
        continue;
      }
      try {
        const thread = await loadTeamsThread(client, ref, { ownerEmail, since: link.watermark });
        const result = await deps.file({
          orgId: job.orgId,
          ownerUserId: job.userId,
          ownerEmail,
          actorUserId: null,
          companyId: link.companyId,
          opportunityId: link.opportunityId,
          thread: { ref, title: thread.title, members: thread.members },
          messages: thread.messages,
        });
        summary.created += result.created;
        const watermark =
          result.watermark && (!link.watermark || result.watermark > link.watermark) ? result.watermark : link.watermark;
        await db.teamsChatLink.updateMany({
          where: { id: link.id, orgId: job.orgId },
          data: { watermark, lastSyncedAt: new Date(), lastError: null, title: thread.title },
        });
      } catch (err) {
        if (err instanceof TeamsThrottledError) throw new ProviderRateLimitError('Microsoft Graph', err.retryAfterMs);
        summary.failed += 1;
        if (err instanceof TeamsConsentError) await mark(link.id, 'consent_required');
        else if (err instanceof TeamsNotFoundError) await mark(link.id, 'not_found');
        else {
          log.error({ err, linkId: link.id }, 'teams sync: link failed');
          await mark(link.id, 'sync_failed');
        }
      }
    }
  });
  return summary;
}

export function startTeamsChatSync(connection: IORedis, log: pino.Logger, workers: Worker[], queues: Queue[]): void {
  const queue = new Queue<TeamsChatSyncJob | Record<string, never>>(TEAMS_CHAT_SYNC.name, {
    connection,
    defaultJobOptions: TEAMS_CHAT_SYNC.defaultJobOptions,
  });
  queues.push(queue);

  const worker = new Worker(
    TEAMS_CHAT_SYNC.name,
    async (job) => {
      if (job.name === 'teams.chat.fanout') {
        const bucket = Math.floor(Date.now() / FANOUT_EVERY_MS);
        let cursor: string | undefined;
        let count = 0;
        while (true) {
          const rows = await prisma.teamsChatLink.findMany({
            where: { keepSyncing: true, deletedAt: null },
            select: { id: true, orgId: true, userId: true, integrationTokenId: true },
            orderBy: { id: 'asc' },
            take: 200,
            ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
          });
          const seen = new Set<string>();
          for (const row of rows) {
            if (seen.has(row.integrationTokenId)) continue;
            seen.add(row.integrationTokenId);
            await queue.add(
              'teams.chat.sync',
              { orgId: row.orgId, userId: row.userId, integrationTokenId: row.integrationTokenId },
              { jobId: `teams-sync-${row.integrationTokenId}-${bucket}` },
            );
            count += 1;
          }
          if (rows.length < 200) break;
          cursor = rows[rows.length - 1]!.id;
        }
        log.info({ count }, 'teams chat sync fanout dispatched');
        return;
      }

      const data = job.data as TeamsChatSyncJob;
      try {
        const summary = await syncTeamsLinksForToken(data, log);
        log.info({ jobId: job.id, ...summary }, 'teams chat sync complete');
      } catch (err) {
        if (err instanceof ProviderRateLimitError) {
          await job.moveToDelayed(Date.now() + err.retryAfterMs, job.token);
          throw new DelayedError();
        }
        if (err instanceof GrantRevokedError) {
          log.warn({ jobId: job.id }, 'teams grant revoked; skipping until reconnect');
          return;
        }
        throw err;
      }
    },
    { connection, concurrency: 3, limiter: { max: 5, duration: 1_000 } },
  );
  worker.on('failed', (job, err) => log.error({ jobId: job?.id, err }, 'teams chat sync failed'));
  workers.push(worker);

  void queue
    .add('teams.chat.fanout', {}, { jobId: 'teams-chat-sync-fanout-cron', repeat: { every: FANOUT_EVERY_MS } })
    .then(() => log.info('teams chat sync fanout scheduled'));
}
