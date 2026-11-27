import { describe, expect, it, vi, beforeEach } from 'vitest';
import type pino from 'pino';

const mocks = vi.hoisted(() => ({
  opportunityFindMany: vi.fn(),
  notificationFindFirst: vi.fn(),
  notificationCreate: vi.fn(),
}));

vi.mock('@bidstack/db', () => ({
  prisma: {
    opportunity: { findMany: mocks.opportunityFindMany },
    notification: { findFirst: mocks.notificationFindFirst, create: mocks.notificationCreate },
  },
  OpportunityStage: { closed_won: 'closed_won', closed_lost: 'closed_lost' },
  Prisma: {
    PrismaClientKnownRequestError: class PrismaClientKnownRequestError extends Error {
      code: string;
      constructor(message: string, code = 'P2002') {
        super(message);
        this.code = code;
      }
    },
  },
}));

import { scanBidDeadlineAlerts } from './bid-deadline-alerts.js';

const log = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  child: () => log,
} as unknown as pino.Logger;

const NOW = new Date('2026-11-27T12:00:00.000Z');
const ORG_ID = 'org-1';
const RUSH_ID = 'opp-rush';
const STORED_RUSH = new Date('2026-06-30T00:00:00.000Z');

function rush(overrides: Record<string, unknown> = {}) {
  return {
    id: RUSH_ID,
    orgId: ORG_ID,
    code: 'OP-2043',
    name: 'Rush University — EHR Cloud Migration',
    customer: 'Rush University System for Health',
    dueDate: STORED_RUSH,
    ownerId: 'user-1',
    stage: 's4_negotiation',
    pipelineStage: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.notificationCreate.mockResolvedValue({ id: 'notif-1' });
  mocks.notificationFindFirst.mockResolvedValue(null);
  mocks.opportunityFindMany.mockResolvedValue([]);
});

describe('scanBidDeadlineAlerts fixture clock', () => {
  it('reads an aged fixture bid as due tomorrow in demo and pulls that stored row into the window', async () => {
    // WHY: every open fixture due date is 2026-06-30 through 2026-09-30. On
    // 2026-11-27 the 30-day lookback starts 2026-10-28, so the scan returns
    // nothing and the demo inbox never shows a bid deadline.
    const row = rush();
    mocks.opportunityFindMany.mockResolvedValue([row]);

    const created = await scanBidDeadlineAlerts(NOW, log, 'demo');

    expect(created).toBe(1);
    expect(mocks.notificationCreate).toHaveBeenCalledTimes(1);
    expect(mocks.notificationCreate.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        data: expect.objectContaining({
          orgId: ORG_ID,
          userId: 'user-1',
          title: 'Bid deadline in 1 day: Rush University — EHR Cloud Migration',
          entityId: RUSH_ID,
          url: `/opportunities/${RUSH_ID}?deadline=1`,
        }),
      }),
    );
    expect(row.dueDate).toBe(STORED_RUSH);
    const where = mocks.opportunityFindMany.mock.calls[0]?.[0].where;
    const or = where.OR as Array<{ code?: string; dueDate?: Date }>;
    expect(
      or.some(
        (row) => row.code === 'OP-2043' && row.dueDate?.toISOString().startsWith('2026-06-30'),
      ),
    ).toBe(true);
    expect(or.some((row) => row.code === 'OP-2041' || row.code === 'OP-2044')).toBe(false);
    expect(where.NOT).toBeUndefined();
  });

  it('slides an aged fixture bid when POLO_DATA_MODE is unset, and keeps the stored date when real', async () => {
    // WHY: the hosted demo leaves POLO_DATA_MODE unset. That is demo. Exact
    // real must keep the stored June date and must not widen the query.
    const previous = process.env.POLO_DATA_MODE;
    try {
      delete process.env.POLO_DATA_MODE;
      mocks.opportunityFindMany.mockResolvedValue([rush()]);
      expect(await scanBidDeadlineAlerts(NOW, log)).toBe(1);
      expect(mocks.notificationCreate.mock.calls[0]?.[0].data.title).toBe(
        'Bid deadline in 1 day: Rush University — EHR Cloud Migration',
      );

      process.env.POLO_DATA_MODE = 'real';
      mocks.notificationCreate.mockClear();
      mocks.opportunityFindMany.mockResolvedValue([rush()]);
      // 2026-06-30 is outside the 30-day lookback on 2026-11-27. Real mode
      // does not pull it in, and a row that did not slide stays silent.
      expect(await scanBidDeadlineAlerts(NOW, log)).toBe(0);
      expect(mocks.notificationCreate).not.toHaveBeenCalled();
      expect(mocks.opportunityFindMany.mock.calls.at(-1)?.[0].where.OR).toBeUndefined();

      const inLookback = new Date('2026-07-10T00:00:00.000Z');
      mocks.notificationCreate.mockClear();
      mocks.opportunityFindMany.mockResolvedValue([rush()]);
      expect(await scanBidDeadlineAlerts(inLookback, log)).toBe(1);
      expect(mocks.notificationCreate.mock.calls[0]?.[0].data.title).toBe(
        'Bid deadline missed: Rush University — EHR Cloud Migration',
      );
      expect(mocks.notificationCreate.mock.calls[0]?.[0].data.body).toContain('overdue by 10 days');
      expect(mocks.opportunityFindMany.mock.calls.at(-1)?.[0].where.OR).toBeUndefined();
    } finally {
      if (previous === undefined) delete process.env.POLO_DATA_MODE;
      else process.env.POLO_DATA_MODE = previous;
    }
  });

  it('keeps the stored June date when the mode is real or not exactly demo', async () => {
    // WHY: on 2026-07-10 the seeded 2026-06-30 date is still inside the
    // lookback. Only exact `demo` may read it as tomorrow. Every other
    // spelling alerts the stored day and does not widen the query.
    const now = new Date('2026-07-10T00:00:00.000Z');
    for (const mode of ['real', 'Demo', 'DEMO', 'demo-x', ' demo', 'notdemo'] as const) {
      mocks.opportunityFindMany.mockResolvedValue([rush()]);
      mocks.notificationCreate.mockClear();
      const created = await scanBidDeadlineAlerts(now, log, mode);
      expect(created).toBe(1);
      expect(mocks.notificationCreate.mock.calls[0]?.[0].data.title).toBe(
        'Bid deadline missed: Rush University — EHR Cloud Migration',
      );
      expect(mocks.notificationCreate.mock.calls[0]?.[0].data.body).toContain('overdue by 10 days');
      expect(mocks.opportunityFindMany.mock.calls.at(-1)?.[0].where.OR).toBeUndefined();
      expect(mocks.opportunityFindMany.mock.calls.at(-1)?.[0].where.NOT).toBeUndefined();
    }
  });

  it('does not slide a live bid or a fixture bid whose date was edited', async () => {
    mocks.opportunityFindMany.mockResolvedValue([
      rush({
        id: 'opp-live',
        code: 'OP-9001',
        name: 'Live pursuit',
        customer: 'Live Co',
        dueDate: new Date('2026-11-20T00:00:00.000Z'),
      }),
      rush({
        id: 'opp-edited',
        code: 'OP-2043',
        name: 'Edited fixture',
        customer: 'Rush University System for Health',
        dueDate: new Date('2026-11-25T00:00:00.000Z'),
        ownerId: 'user-2',
      }),
    ]);

    const created = await scanBidDeadlineAlerts(NOW, log, 'demo');

    expect(created).toBe(2);
    const bodies = mocks.notificationCreate.mock.calls.map((call) => call[0].data.body);
    expect(bodies).toEqual([
      'Live Co — proposal for "Live pursuit" is overdue by 7 days.',
      'Rush University System for Health — proposal for "Edited fixture" is overdue by 2 days.',
    ]);
  });

  it('does not alert a won pipeline fixture that still holds the seed date', async () => {
    // WHY: the query ORs the seeded code in so a still-open fixture can be
    // read as due tomorrow. A won pipeline stage stays on the stored day.
    // That day is outside the lookback, and it must not become a missed alert.
    mocks.opportunityFindMany.mockResolvedValue([
      rush({ pipelineStage: { isWon: true, isLost: false } }),
    ]);

    const created = await scanBidDeadlineAlerts(NOW, log, 'demo');

    expect(created).toBe(0);
    expect(mocks.notificationCreate).not.toHaveBeenCalled();
  });

  it('does not alert a fixture bid the slide carries past the 7-day window', async () => {
    const now = new Date('2026-07-20T00:00:00.000Z');
    mocks.opportunityFindMany.mockResolvedValue([
      rush({
        id: 'opp-ci',
        code: 'OP-2041',
        name: 'CI Financial — IT Modernization & MSP',
        customer: 'CI Financial',
        dueDate: new Date('2026-07-22T00:00:00.000Z'),
      }),
    ]);

    const created = await scanBidDeadlineAlerts(now, log, 'demo');

    expect(created).toBe(0);
    expect(mocks.notificationCreate).not.toHaveBeenCalled();
    const excluded = (mocks.opportunityFindMany.mock.calls[0]?.[0].where.NOT?.OR ?? []).map(
      (row: { code: string }) => row.code,
    );
    expect(excluded).toContain('OP-2041');
  });
});
