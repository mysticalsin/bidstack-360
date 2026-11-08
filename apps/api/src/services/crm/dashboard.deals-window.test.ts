import { describe, expect, it } from 'vitest';

import { buildDashboardSnapshot } from './dashboard.service';
import { DASHBOARD_DEAL_SAMPLE } from './dashboard.utils';

const orgId = '00000000-0000-4000-8000-000000000001';
const ciId = '00000000-0000-4000-8000-0000000000c1';
const otherId = '00000000-0000-4000-8000-0000000000b1';
const oldId = '00000000-0000-4000-8000-0000000000d1';

function opportunity(index: number, companyId: string, customer: string, updatedAt: Date) {
  return {
    id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    code: `D-${index}`,
    customer,
    companyId,
    name: `Deal ${index}`,
    stage: 'qualification',
    pipelineStageId: null,
    valueMicros: 1_000_000n,
    probability: 50,
    dueDate: null,
    ownerId: null,
    updatedAt,
    industry: null,
    logoUrl: null,
    owner: null,
    pipelineStage: null,
  };
}

function dbFor(accountRows: ReturnType<typeof opportunity>[]) {
  const newest = new Date('2026-11-08T00:00:00.000Z').getTime();
  const orgRows = [
    opportunity(0, ciId, 'CI Financial', new Date(newest)),
    ...Array.from({ length: DASHBOARD_DEAL_SAMPLE }, (_, index) =>
      opportunity(index + 1, otherId, 'Other Co', new Date(newest - (index + 1) * 1000)),
    ),
  ];
  const opportunityModel = {
    findMany: async (args: { where?: { companyId?: string; id?: { in?: string[] } } }) => {
      if (args.where?.id?.in) return [];
      if (args.where?.companyId === ciId) return accountRows;
      return orgRows;
    },
    aggregate: async () => ({ _sum: { valueMicros: 0n }, _count: { _all: 0 } }),
  };
  const companyModel = {
    findMany: async () => [
      { id: ciId, name: 'CI Financial', domain: 'ci.example', logoUrl: null, legalName: null },
    ],
  };
  const db = new Proxy(
    {
      opportunity: opportunityModel,
      company: companyModel,
      $queryRaw: async () => [],
      $executeRaw: async () => 1,
      $transaction: async (fn: (tx: unknown) => Promise<void>) => fn(db),
    },
    {
      get(target, prop, receiver) {
        if (Reflect.has(target, prop)) return Reflect.get(target, prop, receiver);
        return new Proxy(
          {},
          {
            get(_model, method) {
              if (method === 'findFirst') return async () => null;
              if (method === 'aggregate') return async () => ({ _sum: {}, _count: { _all: 0 } });
              return async () => [];
            },
          },
        );
      },
    },
  );
  return db;
}

describe('dashboard deal window', () => {
  const older = {
    ...opportunity(0, ciId, 'CI Financial', new Date('2026-11-08T00:00:00.000Z')),
    id: '00000000-0000-4000-8000-0000000000aa',
  };
  const old = {
    ...opportunity(900, ciId, 'CI Financial', new Date('2020-01-01T00:00:00.000Z')),
    id: oldId,
    valueMicros: 9_000_000n,
  };

  it('keeps an older selected-account deal out of the org sample the accounts board totals', async () => {
    // WHY: the default account is still queried for its own latest deals. Folding
    // that list into the org sample makes "latest 100" include older money.
    const snapshot = await buildDashboardSnapshot(
      orgId,
      undefined,
      dbFor([older, old]) as never,
      { warn() {}, info() {} },
    );
    expect(snapshot.dealsSampleCapped).toBe(true);
    expect(snapshot.deals).toHaveLength(DASHBOARD_DEAL_SAMPLE);
    expect(snapshot.deals.some((deal) => deal.id === oldId)).toBe(false);
    expect(snapshot.accountDeals?.some((deal) => deal.id === oldId)).toBe(true);
    const sampledOpen = snapshot.deals.filter((deal) => deal.stage !== 'closed_won' && deal.stage !== 'closed_lost');
    expect(sampledOpen).toHaveLength(DASHBOARD_DEAL_SAMPLE);
  });

  it('still returns the account drilldown when the caller named that account', async () => {
    const snapshot = await buildDashboardSnapshot(
      orgId,
      ciId,
      dbFor([older, old]) as never,
      { warn() {}, info() {} },
    );
    expect(snapshot.deals.some((deal) => deal.id === oldId)).toBe(false);
    expect(snapshot.accountDeals?.map((deal) => deal.id)).toEqual([older.id, oldId]);
    expect(snapshot.dealsSampleCapped).toBe(true);
  });
});
