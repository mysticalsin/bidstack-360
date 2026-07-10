// Integration tests for win/loss reason capture + pattern flagging.
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect } from 'vitest';

import { prisma } from '@bidstack/db';

import { buildServer } from '../server.js';
import {
  createIsolatedOrg,
  dropIsolatedOrg,
  useIsolatedOrgAuth,
} from '../test-support/isolated-org.js';
import { makeSkipIfNoDb } from '../test-support/skip-if-no-db.js';

let server: Awaited<ReturnType<typeof buildServer>>;
let dbReachable = false;
let orgId: string | null = null;
let oppId: string | null = null;
let restoreAuth: (() => void) | null = null;
const CODE = `WL-TEST-${Date.now()}`;

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    dbReachable = false;
    return;
  }
  const org = await createIsolatedOrg('win-loss');
  orgId = org.orgId;
  restoreAuth = useIsolatedOrgAuth(org.clerkOrg);
  const opp = await prisma.opportunity.create({
    data: { orgId, code: CODE, customer: 'WinLossCo', name: 'WL deal', stage: 'closed_lost' },
  });
  oppId = opp.id;
  server = await buildServer();
  await server.ready();
});

afterAll(async () => {
  if (oppId) {
    await prisma.winLossRecord.deleteMany({ where: { opportunityId: oppId } });
    await prisma.opportunity.deleteMany({ where: { id: oppId } });
  }
  if (orgId) {
    await prisma.auditLog.deleteMany({
      where: { orgId, action: 'win_loss.record', targetId: oppId ?? undefined },
    });
  }
  if (server) await server.close();
  if (restoreAuth) restoreAuth();
  if (orgId) await dropIsolatedOrg(orgId);
  if (dbReachable) await prisma.$disconnect();
});

const t = makeSkipIfNoDb(() => dbReachable && !!orgId && !!oppId);

describe('win/loss routes', () => {
  t('records a loss reason (upsert), reads it back, and re-upsert updates it', async () => {
    const put = await server.inject({
      method: 'PUT',
      url: `/api/win-loss/${oppId}`,
      payload: {
        outcome: 'lost',
        reason: 'price',
        competitor: 'Acme Rival',
        note: 'Too expensive',
      },
    });
    expect(put.statusCode).toBe(200);
    expect((put.json() as { reason: string }).reason).toBe('price');

    const get = await server.inject({ method: 'GET', url: `/api/win-loss/${oppId}` });
    expect(get.statusCode).toBe(200);
    expect((get.json() as { competitor: string }).competitor).toBe('Acme Rival');

    // Re-record with a different reason — one record per opp (no duplicate).
    const put2 = await server.inject({
      method: 'PUT',
      url: `/api/win-loss/${oppId}`,
      payload: { outcome: 'lost', reason: 'timing' },
    });
    expect(put2.statusCode).toBe(200);
    expect((put2.json() as { reason: string }).reason).toBe('timing');
    const count = await prisma.winLossRecord.count({ where: { opportunityId: oppId! } });
    expect(count).toBe(1);
  });

  t('patterns aggregate includes the recorded loss and flags a top loss reason', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/win-loss/patterns' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      rows: { outcome: string; reason: string; count: number }[];
      totalLost: number;
      topLossReason: string | null;
    };
    expect(body.totalLost).toBeGreaterThanOrEqual(1);
    expect(body.topLossReason).not.toBeNull();
    expect(body.rows.some((r) => r.outcome === 'lost')).toBe(true);
  });

  t('analysis buckets by quarter, breaks down reasons, and lists the closed bid', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/win-loss/analysis' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      totalWon: number;
      totalLost: number;
      winRatePct: number | null;
      truncated: boolean;
      quarters: { quarter: string; won: number; lost: number }[];
      reasons: { reason: string; won: number; lost: number }[];
      recent: { opportunityId: string; name: string; decidedAt: string }[];
    };
    expect(body.totalLost).toBeGreaterThanOrEqual(1);
    // A handful of records is well under the 1 000 scan cap — nothing dropped.
    expect(body.truncated).toBe(false);
    expect(body.winRatePct).not.toBeNull();
    // Quarter buckets must account for every closed record — the trend chart
    // is wrong if the buckets and the totals disagree.
    const bucketSum = body.quarters.reduce((s, q) => s + q.won + q.lost, 0);
    expect(bucketSum).toBe(body.totalWon + body.totalLost);
    expect(body.quarters.every((q) => /^\d{4}-Q[1-4]$/.test(q.quarter))).toBe(true);
    // The loss recorded above (reason re-upserted to "timing") shows in the
    // reason breakdown and the recent closed table deep-link payload.
    expect(body.reasons.some((r) => r.reason === 'timing' && r.lost >= 1)).toBe(true);
    expect(body.recent.some((r) => r.opportunityId === oppId && r.name === 'WL deal')).toBe(true);
  });

  t('analysis owner + date filters scope the aggregate (org-scoped, no leakage)', async () => {
    // A random owner uuid matches nothing — filters must reach through the
    // opportunity join, not silently return the unfiltered aggregate.
    const owned = await server.inject({
      method: 'GET',
      url: `/api/win-loss/analysis?ownerId=${randomUUID()}`,
    });
    expect(owned.statusCode).toBe(200);
    const ownedBody = owned.json() as { totalWon: number; totalLost: number; recent: unknown[] };
    expect(ownedBody.totalWon + ownedBody.totalLost).toBe(0);
    expect(ownedBody.recent).toHaveLength(0);

    // A future-only date range excludes today's record.
    const future = await server.inject({
      method: 'GET',
      url: '/api/win-loss/analysis?from=2099-01-01&to=2099-12-31',
    });
    expect(future.statusCode).toBe(200);
    const futureBody = future.json() as { totalWon: number; totalLost: number; winRatePct: number | null };
    expect(futureBody.totalWon + futureBody.totalLost).toBe(0);
    expect(futureBody.winRatePct).toBeNull();

    // Malformed date rejected by schema, not treated as "no filter".
    const bad = await server.inject({
      method: 'GET',
      url: '/api/win-loss/analysis?from=01-01-2099',
    });
    expect(bad.statusCode).toBe(400);
  });

  t('recording against another org’s opportunity 404s (tenant guard)', async () => {
    const foreignOrg = await prisma.org.create({
      data: { name: 'WL Foreign', clerkOrg: `org_wl_${Date.now()}` },
    });
    const foreignOpp = await prisma.opportunity.create({
      data: {
        orgId: foreignOrg.id,
        code: `WLF-${Date.now()}`,
        customer: 'X',
        name: 'Y',
        stage: 'closed_won',
      },
    });
    try {
      const res = await server.inject({
        method: 'PUT',
        url: `/api/win-loss/${foreignOpp.id}`,
        payload: { outcome: 'won', reason: 'product_fit' },
      });
      expect(res.statusCode).toBe(404);
    } finally {
      await prisma.winLossRecord.deleteMany({ where: { opportunityId: foreignOpp.id } });
      await prisma.opportunity.deleteMany({ where: { orgId: foreignOrg.id } });
      await prisma.org.delete({ where: { id: foreignOrg.id } });
    }
  });
});
