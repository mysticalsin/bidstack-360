import { randomUUID } from 'node:crypto';

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

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
});
