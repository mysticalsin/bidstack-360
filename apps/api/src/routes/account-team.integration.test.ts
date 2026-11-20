// Account team CRUD, allocation totals, follow state, channel prefs, Teams
// webhook validation, and the end-to-end alert path (note on an account ->
// in-app alert for a team member, never for the actor).
import { afterAll, beforeAll, describe, expect } from 'vitest';

import { prisma } from '@bidstack/db';

import { buildServer } from '../server.js';
import { __setTeamsPosterForTest } from './notifications.js';
import {
  createIsolatedOrg,
  dropIsolatedOrg,
  useIsolatedOrgAuth,
} from '../test-support/isolated-org.js';
import { makeSkipIfNoDb } from '../test-support/skip-if-no-db.js';

let server: Awaited<ReturnType<typeof buildServer>>;
let dbReachable = false;
let orgId: string | null = null;
let actorId: string | null = null;
let mateId: string | null = null;
let companyA: string | null = null;
let companyB: string | null = null;
let restoreAuth: (() => void) | null = null;
const previousKey = process.env.INTEGRATION_TOKEN_KEY;

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    dbReachable = false;
    return;
  }
  process.env.INTEGRATION_TOKEN_KEY = 'a'.repeat(64);
  const org = await createIsolatedOrg('account-team');
  orgId = org.orgId;
  restoreAuth = useIsolatedOrgAuth(org.clerkOrg);
  const users = await prisma.user.findMany({
    where: { orgId },
    orderBy: { createdAt: 'asc' },
    take: 2,
  });
  actorId = users[0]?.id ?? null;
  mateId = users[1]?.id ?? null;
  const [a, b] = await Promise.all([
    prisma.company.create({ data: { orgId, name: 'Pfizer S21' } }),
    prisma.company.create({ data: { orgId, name: 'Roche S21' } }),
  ]);
  companyA = a.id;
  companyB = b.id;
  server = await buildServer();
  await server.ready();
});

afterAll(async () => {
  __setTeamsPosterForTest(null);
  if (server) await server.close();
  if (restoreAuth) restoreAuth();
  if (orgId) await dropIsolatedOrg(orgId);
  if (previousKey === undefined) delete process.env.INTEGRATION_TOKEN_KEY;
  else process.env.INTEGRATION_TOKEN_KEY = previousKey;
  if (dbReachable) await prisma.$disconnect();
});

const t = makeSkipIfNoDb(() => dbReachable && !!orgId && !!actorId && !!mateId && !!companyA);

async function waitFor<T>(fn: () => Promise<T | null>, tries = 40): Promise<T | null> {
  for (let i = 0; i < tries; i++) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 100));
  }
  return null;
}

describe('account team routes', () => {
  t('add, list, edit and remove a member; totals span accounts and flag over 100%', async () => {
    const add = await server.inject({
      method: 'POST',
      url: `/api/v1/companies/${companyA}/team`,
      payload: { userId: mateId, role: 'pre_sales', allocationPct: 70, startDate: '2026-11-01' },
    });
    expect(add.statusCode).toBe(201);
    const member = add.json() as { id: string; totalAllocationPct: number; role: string };
    expect(member.role).toBe('pre_sales');
    expect(member.totalAllocationPct).toBe(70);

    const dup = await server.inject({
      method: 'POST',
      url: `/api/v1/companies/${companyA}/team`,
      payload: { userId: mateId, role: 'other' },
    });
    expect(dup.statusCode).toBe(409);

    const second = await server.inject({
      method: 'POST',
      url: `/api/v1/companies/${companyB}/team`,
      payload: { userId: mateId, role: 'bid_manager', allocationPct: 50 },
    });
    expect(second.statusCode).toBe(201);

    const alloc = await server.inject({
      method: 'GET',
      url: `/api/v1/companies/allocations/${mateId}`,
    });
    expect(alloc.statusCode).toBe(200);
    expect((alloc.json() as { totalPct: number }).totalPct).toBe(120);

    const list = await server.inject({ method: 'GET', url: `/api/v1/companies/${companyA}/team` });
    expect(list.statusCode).toBe(200);
    const team = list.json() as { members: Array<{ id: string; totalAllocationPct: number }> };
    expect(team.members).toHaveLength(1);
    expect(team.members[0]!.totalAllocationPct).toBe(120);

    const badDates = await server.inject({
      method: 'PATCH',
      url: `/api/v1/companies/${companyA}/team/${member.id}`,
      payload: { endDate: '2026-10-01' },
    });
    expect(badDates.statusCode).toBe(400);

    const edit = await server.inject({
      method: 'PATCH',
      url: `/api/v1/companies/${companyA}/team/${member.id}`,
      payload: { allocationPct: 40, role: 'delivery_lead' },
    });
    expect(edit.statusCode).toBe(200);
    expect((edit.json() as { totalAllocationPct: number }).totalAllocationPct).toBe(90);

    const audits = await prisma.auditLog.count({
      where: { orgId: orgId!, targetId: companyA!, action: { startsWith: 'account_team.' } },
    });
    expect(audits).toBe(2);

    const tooHigh = await server.inject({
      method: 'PATCH',
      url: `/api/v1/companies/${companyA}/team/${member.id}`,
      payload: { allocationPct: 101 },
    });
    expect(tooHigh.statusCode).toBe(400);

    const del = await server.inject({
      method: 'DELETE',
      url: `/api/v1/companies/${companyB}/team/${(second.json() as { id: string }).id}`,
    });
    expect(del.statusCode).toBe(204);
  });

  t('team routes 404 for a company in another org', async () => {
    const other = await prisma.org.create({
      data: { clerkOrg: `org_s21_other_${Date.now()}`, name: 'Other S21' },
    });
    const foreign = await prisma.company.create({ data: { orgId: other.id, name: 'Foreign S21' } });
    try {
      const res = await server.inject({
        method: 'GET',
        url: `/api/v1/companies/${foreign.id}/team`,
      });
      expect(res.statusCode).toBe(404);
      const add = await server.inject({
        method: 'POST',
        url: `/api/v1/companies/${foreign.id}/team`,
        payload: { userId: mateId, role: 'other' },
      });
      expect(add.statusCode).toBe(404);
    } finally {
      await prisma.org.delete({ where: { id: other.id } }).catch(() => undefined);
    }
  });
});

describe('follow routes', () => {
  t('follow, mute, unmute and unfollow update the caller state', async () => {
    const get0 = await server.inject({
      method: 'GET',
      url: `/api/v1/companies/${companyB}/follow`,
    });
    expect(get0.json()).toEqual({ following: false, muted: false, reasons: [] });

    const follow = await server.inject({
      method: 'PUT',
      url: `/api/v1/companies/${companyB}/follow`,
      payload: { action: 'follow' },
    });
    expect(follow.json()).toEqual({ following: true, muted: false, reasons: ['explicit'] });

    const mute = await server.inject({
      method: 'PUT',
      url: `/api/v1/companies/${companyB}/follow`,
      payload: { action: 'mute' },
    });
    expect(mute.json()).toMatchObject({ following: false, muted: true });

    const unfollow = await server.inject({
      method: 'PUT',
      url: `/api/v1/companies/${companyB}/follow`,
      payload: { action: 'unfollow' },
    });
    expect(unfollow.json()).toEqual({ following: false, muted: false, reasons: [] });
  });

  t('the key account owner follows automatically', async () => {
    await prisma.company.update({ where: { id: companyB! }, data: { keyAccountOwnerId: actorId } });
    const res = await server.inject({ method: 'GET', url: `/api/v1/companies/${companyB}/follow` });
    expect(res.json()).toEqual({ following: true, muted: false, reasons: ['key_account_owner'] });
  });
});

describe('alerts end to end', () => {
  t('a note on the account alerts the team member and not the author', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/notes',
      payload: { accountId: 'pfizer-s21', companyId: companyA, title: 'Kickoff', bodyMd: 'Agenda' },
    });
    expect(res.statusCode).toBe(201);
    const alert = await waitFor(() =>
      prisma.notification.findFirst({
        where: { orgId: orgId!, userId: mateId!, type: 'account_activity' },
      }),
    );
    expect(alert?.title).toBe('New note on Pfizer S21');
    expect(alert?.url).toBe(`/companies/${companyA}`);
    const own = await prisma.notification.count({
      where: { orgId: orgId!, userId: actorId!, type: 'account_activity' },
    });
    expect(own).toBe(0);
  });
});

describe('channel prefs and Teams webhook', () => {
  t('defaults are in-app only; updates persist', async () => {
    const get = await server.inject({ method: 'GET', url: '/api/v1/notifications/channels' });
    expect(get.statusCode).toBe(200);
    const body = get.json() as {
      groups: Record<string, { in_app: boolean; email: boolean; teams: boolean }>;
      dailyDigest: boolean;
    };
    expect(body.groups.account_activity).toEqual({ in_app: true, email: false, teams: false });
    expect(body.dailyDigest).toBe(false);

    const put = await server.inject({
      method: 'PUT',
      url: '/api/v1/notifications/channels',
      payload: {
        groups: { ...body.groups, deals: { in_app: true, email: true, teams: false } },
        dailyDigest: true,
      },
    });
    expect(put.statusCode).toBe(200);
    expect((put.json() as typeof body).groups.deals.email).toBe(true);
    expect((put.json() as typeof body).dailyDigest).toBe(true);
  });

  t('refuses a non-Microsoft webhook, stores a valid one encrypted, and sends a test', async () => {
    const bad = await server.inject({
      method: 'PUT',
      url: '/api/v1/notifications/teams-webhook',
      payload: { url: 'https://evil.example/hook' },
    });
    expect(bad.statusCode).toBe(400);

    const url =
      'https://prod-1.westeurope.logic.azure.com/workflows/s21/triggers/manual/paths/invoke?sig=abc';
    const ok = await server.inject({
      method: 'PUT',
      url: '/api/v1/notifications/teams-webhook',
      payload: { url },
    });
    expect(ok.statusCode).toBe(200);
    expect((ok.json() as { teamsWebhook: unknown }).teamsWebhook).toEqual({
      configured: true,
      host: 'prod-1.westeurope.logic.azure.com',
    });
    const row = await prisma.notificationPref.findUnique({ where: { userId: actorId! } });
    expect(row?.teamsWebhookEnc).toBeTruthy();
    expect(row?.teamsWebhookEnc).not.toContain('logic.azure.com');

    const posted: string[] = [];
    __setTeamsPosterForTest(async (u) => {
      posted.push(u);
      return { ok: true, status: 202 };
    });
    const test = await server.inject({
      method: 'POST',
      url: '/api/v1/notifications/teams-webhook/test',
    });
    expect(test.json()).toMatchObject({ ok: true, status: 202 });
    expect(posted).toEqual([url]);

    const clear = await server.inject({
      method: 'DELETE',
      url: '/api/v1/notifications/teams-webhook',
    });
    expect((clear.json() as { teamsWebhook: unknown }).teamsWebhook).toEqual({
      configured: false,
      host: null,
    });
  });
});
