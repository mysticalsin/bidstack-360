import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  companyFindFirst: vi.fn(),
  companyCount: vi.fn(),
  teamFindMany: vi.fn(),
  oppFindMany: vi.fn(),
  followFindMany: vi.fn(),
  userFindMany: vi.fn(),
  userFindFirst: vi.fn(),
  prefFindMany: vi.fn(),
  notifFindFirst: vi.fn(),
  notifCount: vi.fn(),
  notifCreate: vi.fn(),
  notifUpdateMany: vi.fn(),
  publish: vi.fn(),
  enqueue: vi.fn(),
  activityFindMany: vi.fn(),
  contactFindMany: vi.fn(),
  digestListeners: new Set<(d: unknown) => void>(),
}));

vi.mock('@bidstack/db', () => ({
  prisma: {
    company: { findFirst: m.companyFindFirst, count: m.companyCount },
    activity: { findMany: m.activityFindMany },
    contact: { findMany: m.contactFindMany },
    accountTeamMember: { findMany: m.teamFindMany },
    opportunity: { findMany: m.oppFindMany },
    accountFollow: { findMany: m.followFindMany },
    user: { findMany: m.userFindMany, findFirst: m.userFindFirst },
    notificationPref: { findMany: m.prefFindMany, findUnique: vi.fn() },
    notification: {
      findFirst: m.notifFindFirst,
      count: m.notifCount,
      create: m.notifCreate,
      updateMany: m.notifUpdateMany,
    },
  },
  subscribeAccountActivityDigest: (fn: (d: unknown) => void) => {
    m.digestListeners.add(fn);
    return () => m.digestListeners.delete(fn);
  },
}));
vi.mock('../lib/access-scope.js', () => ({
  getAccessScope: vi.fn(async () => ({ unrestricted: true })),
  applyCompanyScope: (w: unknown) => w,
}));
vi.mock('./realtime.service.js', () => ({ publish: m.publish }));
vi.mock('../queues/notification-delivery.js', () => ({ enqueueNotificationDelivery: m.enqueue }));

import {
  emitAccountEvent,
  emitActivitiesAccountEvents,
  installAccountActivityAlerts,
  uninstallAccountActivityAlerts,
} from './account-events.service.js';

const NOW = new Date('2026-11-07T12:00:00Z');
const base = {
  orgId: 'org',
  companyId: 'c1',
  kind: 'activity_logged' as const,
  actorUserId: 'actor',
  entityType: 'activity',
  entityId: 'a1',
  title: (company: string) => `New meeting on ${company}`,
};

function setup(
  opts: {
    follows?: Array<{ userId: string; muted: boolean }>;
    prefs?: Array<Record<string, unknown>>;
  } = {},
) {
  m.companyFindFirst.mockResolvedValue({ id: 'c1', name: 'Pfizer', keyAccountOwnerId: 'kam' });
  m.teamFindMany.mockResolvedValue([{ userId: 'team1' }, { userId: 'actor' }]);
  m.oppFindMany.mockResolvedValue([{ ownerId: 'owner1' }, { ownerId: null }]);
  m.followFindMany.mockResolvedValue(opts.follows ?? []);
  m.userFindMany.mockImplementation(async ({ where }: { where: { id: { in: string[] } } }) =>
    where.id.in.map((id) => ({ id })),
  );
  m.userFindFirst.mockResolvedValue({ name: 'Ana Actor', email: 'ana@polo.test' });
  m.prefFindMany.mockResolvedValue(opts.prefs ?? []);
  m.notifFindFirst.mockResolvedValue(null);
  m.notifCount.mockResolvedValue(0);
  m.notifCreate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    id: `n-${data.userId}`,
    ...data,
  }));
  m.notifUpdateMany.mockResolvedValue({ count: 1 });
}

beforeEach(() => {
  vi.clearAllMocks();
  m.publish.mockResolvedValue(undefined);
  m.enqueue.mockResolvedValue('job');
});

describe('emitAccountEvent', () => {
  it('notifies team, key account owner and opp owners, never the actor', async () => {
    setup();
    const res = await emitAccountEvent(base, NOW);
    const recipients = m.notifCreate.mock.calls.map((c) => c[0].data.userId).sort();
    expect(recipients).toEqual(['kam', 'owner1', 'team1']);
    expect(res.created).toBe(3);
    const row = m.notifCreate.mock.calls[0]![0].data;
    expect(row.title).toBe('New meeting on Pfizer');
    expect(row.body).toBe('Ana Actor: New meeting on Pfizer');
    expect(row.type).toBe('account_activity');
    expect(m.publish).toHaveBeenCalledWith(
      'notification:user:kam',
      'notification',
      expect.objectContaining({ title: 'New meeting on Pfizer' }),
    );
  });

  it('a muted follower gets nothing; an explicit follower gets the alert', async () => {
    setup({
      follows: [
        { userId: 'kam', muted: true },
        { userId: 'fan', muted: false },
      ],
    });
    await emitAccountEvent(base, NOW);
    const recipients = m.notifCreate.mock.calls.map((c) => c[0].data.userId).sort();
    expect(recipients).toEqual(['fan', 'owner1', 'team1']);
  });

  it('coalesces a repeat on the same account within 10 minutes into one counted row', async () => {
    setup();
    m.notifFindFirst.mockResolvedValue({
      id: 'existing',
      eventCount: 2,
      lastEventAt: new Date('2026-11-07T11:55:00Z'),
    });
    const res = await emitAccountEvent(base, NOW);
    expect(m.notifCreate).not.toHaveBeenCalled();
    expect(res.coalesced).toBe(3);
    const update = m.notifUpdateMany.mock.calls[0]![0];
    expect(update.data.eventCount).toBe(3);
    expect(update.data.title).toBe('3 new updates on Pfizer');
  });

  it('prefs gate channels: in-app off writes no row; email and Teams on queue copies', async () => {
    setup({
      prefs: [
        {
          userId: 'kam',
          channelPrefs: {
            groups: { account_activity: { in_app: false, email: true, teams: true } },
          },
          teamsWebhookEnc: 'enc',
        },
      ],
    });
    await emitAccountEvent(base, NOW);
    expect(m.notifCreate.mock.calls.map((c) => c[0].data.userId)).not.toContain('kam');
    const kamJobs = m.enqueue.mock.calls.map((c) => c[0]).filter((j) => j.userId === 'kam');
    expect(kamJobs.map((j) => j.channel).sort()).toEqual(['email', 'teams']);
    expect(kamJobs[0].notificationId).toBeNull();
    expect(m.enqueue.mock.calls.filter((c) => c[0].userId !== 'kam')).toHaveLength(0);
  });

  it('Teams is not queued without a saved webhook', async () => {
    setup({
      prefs: [
        {
          userId: 'kam',
          channelPrefs: {
            groups: { account_activity: { in_app: true, email: false, teams: true } },
          },
          teamsWebhookEnc: null,
        },
      ],
    });
    await emitAccountEvent(base, NOW);
    expect(m.enqueue).not.toHaveBeenCalled();
  });

  it('deal events follow the deals group, not account activity', async () => {
    setup({
      prefs: [
        {
          userId: 'kam',
          channelPrefs: { groups: { deals: { in_app: false, email: false, teams: false } } },
          teamsWebhookEnc: null,
        },
      ],
    });
    await emitAccountEvent(
      { ...base, kind: 'opportunity_stage_changed', title: 'Stage moved to Proposal on Pfizer' },
      NOW,
    );
    expect(m.notifCreate.mock.calls.map((c) => c[0].data.userId)).not.toContain('kam');
  });

  it('excludes users already told by another notification', async () => {
    setup();
    await emitAccountEvent({ ...base, excludeUserIds: ['owner1'] }, NOW);
    expect(m.notifCreate.mock.calls.map((c) => c[0].data.userId)).not.toContain('owner1');
  });

  it('rate limits new in-app rows per user per hour', async () => {
    setup();
    m.notifCount.mockResolvedValue(60);
    const res = await emitAccountEvent(base, NOW);
    expect(m.notifCreate).not.toHaveBeenCalled();
    expect(res.skipped).toBe(3);
  });

  it('does nothing for a company outside the org', async () => {
    setup();
    m.companyFindFirst.mockResolvedValue(null);
    expect(await emitAccountEvent(base, NOW)).toEqual({
      recipients: 0,
      created: 0,
      coalesced: 0,
      skipped: 0,
    });
  });

  it('bounds every findMany so the request query guard never rejects the caller', async () => {
    setup();
    await emitAccountEvent(base, NOW);
    const calls = [
      m.teamFindMany,
      m.oppFindMany,
      m.followFindMany,
      m.userFindMany,
      m.prefFindMany,
    ].flatMap((fn) => fn.mock.calls);
    expect(calls.length).toBe(5);
    for (const [args] of calls) {
      const take = (args as { take?: number }).take;
      expect(take).toBeGreaterThan(0);
      expect(take).toBeLessThanOrEqual(1000);
    }
  });
});

describe('emitActivitiesAccountEvents (synced and ingested activity)', () => {
  function activities(rows: Array<{ id: string; type: string }>) {
    m.activityFindMany.mockResolvedValue(
      rows.map((r) => ({ ...r, entityType: 'company', entityId: 'c1' })),
    );
    m.contactFindMany.mockResolvedValue([]);
  }

  it('one import run on one account is one counted alert, never to the owner or colleagues on it', async () => {
    setup();
    activities([
      { id: 'a1', type: 'meeting' },
      { id: 'a2', type: 'email' },
      { id: 'a3', type: 'email' },
    ]);
    await emitActivitiesAccountEvents({
      orgId: 'org',
      activityIds: ['a1', 'a2', 'a3'],
      actorUserId: 'owner1',
      excludeUserIds: ['owner1', 'team1', 'actor'],
    });
    const rows = m.notifCreate.mock.calls.map((c) => c[0].data);
    expect(rows.map((r) => r.userId).sort()).toEqual(['kam']);
    expect(rows[0]).toMatchObject({ title: '3 new activities on Pfizer', eventCount: 3 });
  });

  it('a single synced meeting reads as a new meeting', async () => {
    setup();
    activities([{ id: 'a1', type: 'meeting' }]);
    await emitActivitiesAccountEvents({ orgId: 'org', activityIds: ['a1'], actorUserId: null });
    expect(m.notifCreate.mock.calls[0]![0].data.title).toBe('New meeting on Pfizer');
  });

  it('system rows (stage changes logged by sync) raise nothing', async () => {
    setup();
    activities([{ id: 'a1', type: 'stage_change' }]);
    await emitActivitiesAccountEvents({ orgId: 'org', activityIds: ['a1'], actorUserId: null });
    expect(m.companyFindFirst).not.toHaveBeenCalled();
    expect(m.notifCreate).not.toHaveBeenCalled();
  });

  it('the in-process digest subscriber is installed once and forwards exclusions', async () => {
    setup();
    activities([{ id: 'a1', type: 'email' }]);
    installAccountActivityAlerts();
    installAccountActivityAlerts();
    try {
      expect(m.digestListeners.size).toBe(1);
      for (const fn of m.digestListeners) {
        fn({
          orgId: 'org',
          companyId: 'c1',
          activityIds: ['a1'],
          actorUserId: 'actor',
          excludeUserIds: ['actor', 'kam'],
        });
      }
      await vi.waitFor(() => expect(m.notifCreate).toHaveBeenCalled());
      const recipients = m.notifCreate.mock.calls.map((c) => c[0].data.userId).sort();
      expect(recipients).toEqual(['owner1', 'team1']);
    } finally {
      uninstallAccountActivityAlerts();
    }
    expect(m.digestListeners.size).toBe(0);
  });
});
