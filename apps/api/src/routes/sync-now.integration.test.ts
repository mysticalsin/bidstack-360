import { randomUUID } from 'node:crypto';

import { Queue } from 'bullmq';
import type { FastifyInstance } from 'fastify';
import type IORedis from 'ioredis';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { prisma } from '@bidstack/db';

import { buildServer } from '../server.js';
import { startSyncRun } from '../services/sync-now/index.js';
import {
  createIsolatedOrg,
  dropIsolatedOrg,
  useIsolatedOrgAuth,
} from '../test-support/isolated-org.js';

// Sync now over the real DB and Redis: a run is a BullMQ job keyed by the
// idempotency key, the UI polls it, and runs never leak across orgs.
describe('sync now', () => {
  let server: FastifyInstance;
  let orgId: string;
  let userId: string;
  let restoreAuth: () => void;

  beforeAll(async () => {
    const org = await createIsolatedOrg('syncnow');
    orgId = org.orgId;
    restoreAuth = useIsolatedOrgAuth(org.clerkOrg);
    const admin = await prisma.user.findFirst({
      where: { orgId },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    userId = admin!.id;
    server = await buildServer();
    await server.ready();
  });

  afterAll(async () => {
    await server?.close();
    restoreAuth?.();
    if (orgId) await dropIsolatedOrg(orgId);
  });

  it('starts a Dust run and the same idempotency key returns the same run', async () => {
    const key = `sync-${randomUUID()}`;
    const first = await startSyncRun('dust', { orgId, userId, idempotencyKey: key });
    const second = await startSyncRun('dust', { orgId, userId, idempotencyKey: key });
    expect(first.runId).toBe(second.runId);
    expect(['queued', 'running', 'completed']).toContain(first.state);
  });

  it('POST returns 202 with a run the UI can poll', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/sync-now/dust',
      headers: { 'idempotency-key': `sync-${randomUUID()}` },
      payload: {},
    });
    expect(res.statusCode).toBe(202);
    const run = res.json();
    expect(run.source).toBe('dust');

    const poll = await server.inject({
      method: 'GET',
      url: `/api/v1/sync-now/dust/runs/${run.runId}`,
    });
    expect(poll.statusCode).toBe(200);
    expect(poll.json().runId).toBe(run.runId);
  });

  it('a run id from another org is not found', async () => {
    const other = await createIsolatedOrg('syncnow-other');
    try {
      const otherUser = await prisma.user.findFirst({
        where: { orgId: other.orgId },
        select: { id: true },
      });
      const run = await startSyncRun('dust', {
        orgId: other.orgId,
        userId: otherUser!.id,
        idempotencyKey: `sync-${randomUUID()}`,
      });
      const res = await server.inject({
        method: 'GET',
        url: `/api/v1/sync-now/dust/runs/${run.runId}`,
      });
      expect(res.statusCode).toBe(404);
    } finally {
      await dropIsolatedOrg(other.orgId);
    }
  });

  it('HubSpot sync refuses cleanly when HubSpot is not connected', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/sync-now/hubspot',
      headers: { 'idempotency-key': `sync-${randomUUID()}` },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it('HubSpot overview reports the last completed import time', async () => {
    const completedAt = new Date('2026-11-01T10:00:00Z');
    await prisma.migrationJob.create({
      data: {
        orgId,
        userId,
        source: 'HUBSPOT_OAUTH',
        status: 'COMPLETE',
        totalRows: 1,
        processedRows: 1,
        completedAt,
      },
    });
    const res = await server.inject({ method: 'GET', url: '/api/v1/sync-now/hubspot' });
    expect(res.statusCode).toBe(200);
    expect(res.json().lastSyncedAt).toBe(completedAt.toISOString());
  });

  it('rejects an unknown source', async () => {
    const res = await server.inject({ method: 'POST', url: '/api/v1/sync-now/ftp', payload: {} });
    expect(res.statusCode).toBe(400);
  });

  // WHY: Sync now opens its own HubSpot migration queue and the dust-poll
  // queue on first use, and nothing closed them, so their Redis connections
  // outlived the server.
  it('closes the queues it opened, and their Redis connections, when the server closes', async () => {
    const own = await buildServer();
    await own.ready();
    await startSyncRun('dust', { orgId, userId, idempotencyKey: `sync-${randomUUID()}` });
    // Not connected to HubSpot, so this refuses, after opening the migration queue.
    await startSyncRun('hubspot', { orgId, userId, idempotencyKey: `sync-${randomUUID()}` }).catch(() => undefined);
    const close = vi.spyOn(Queue.prototype, 'close');

    await own.close();

    const closed = close.mock.contexts as Queue[];
    expect(closed.map((q) => q.name).sort()).toEqual(['dust-poll', 'migration']);
    for (const queue of closed) {
      const connection = queue.opts.connection as IORedis;
      // quit() resolves on Redis's OK; the client reaches 'end' when the socket closes just after.
      for (let i = 0; i < 40 && connection.status !== 'end'; i++) await new Promise((r) => setTimeout(r, 50));
      expect(connection.status).toBe('end');
    }
    close.mockRestore();
  });

  // WHY: each close quit its connection only after a successful queue close,
  // so a failing close left the connection open.
  it('quits both Redis connections even when closing the queues fails', async () => {
    const own = await buildServer();
    await own.ready();
    await startSyncRun('dust', { orgId, userId, idempotencyKey: `sync-${randomUUID()}` });
    await startSyncRun('hubspot', { orgId, userId, idempotencyKey: `sync-${randomUUID()}` }).catch(() => undefined);
    const close = vi.spyOn(Queue.prototype, 'close').mockRejectedValue(new Error('synthetic close failure'));

    await own.close().catch(() => undefined);

    const closed = close.mock.contexts as Queue[];
    close.mockRestore();
    expect(closed.map((q) => q.name).sort()).toEqual(['dust-poll', 'migration']);
    for (const queue of closed) {
      const connection = queue.opts.connection as IORedis;
      for (let i = 0; i < 40 && connection.status !== 'end'; i++) await new Promise((r) => setTimeout(r, 50));
      expect(connection.status).toBe('end');
    }
  });
});
