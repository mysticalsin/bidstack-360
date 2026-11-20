// Inspector L-70 on the merged open-total sample (PR #70, head 5a1a344a).
// Synthetic deals only. The open total has to survive a 500-row page, and a
// total past the safe integer has to stay on the tile.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { prisma } from '@bidstack/db';
import { composeBrief, formatCompactMoney, type AccountKeyNumbers, type AccountPositioning } from '@bidstack/shared';

import { invalidateAccessScope } from '../../lib/access-scope.js';
import { buildServer } from '../../server.js';
import { createIsolatedOrg, dropIsolatedOrg, useIsolatedOrgAuth } from '../../test-support/isolated-org.js';

const TAG = `ot${Date.now().toString(36)}`;
const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY);
const TEN_BN_MICROS = 10_000_000_000_000_000n;
const OLD_OPEN_MICROS = 5_000_000n;

let server: FastifyInstance;
let org = { orgId: '', clerkOrg: '' };
let restoreAuth: (() => void) | null = null;
let crowdedId = '';
let hugeId = '';

function spoken(brief: AccountPositioning['brief']): string {
  return composeBrief(brief, formatCompactMoney, (micros) => {
    const value = BigInt(micros);
    const units = Number(value / 1_000_000n) + Number(value % 1_000_000n) / 1_000_000;
    return formatCompactMoney(units, 'EUR');
  });
}

beforeAll(async () => {
  org = await createIsolatedOrg('open-total');
  restoreAuth = useIsolatedOrgAuth(org.clerkOrg);
  const crowded = await prisma.company.create({ data: { orgId: org.orgId, name: `${TAG} Crowded` } });
  const huge = await prisma.company.create({ data: { orgId: org.orgId, name: `${TAG} Huge` } });
  crowdedId = crowded.id;
  hugeId = huge.id;
  const closedAt = ago(30);
  await prisma.opportunity.createMany({
    data: Array.from({ length: 500 }, (_, index) => ({
      orgId: org.orgId,
      companyId: crowdedId,
      code: `${TAG}-c${index}`,
      customer: `${TAG} Crowded`,
      name: `Closed sample ${index}`,
      stage: 'closed_won' as const,
      valueMicros: 1n,
      closedAt,
      createdAt: ago(40),
    })),
  });
  const oldOpen = await prisma.opportunity.create({
    data: {
      orgId: org.orgId,
      companyId: crowdedId,
      code: `${TAG}-old`,
      customer: `${TAG} Crowded`,
      name: 'Untouched open',
      stage: 's2_sent',
      valueMicros: OLD_OPEN_MICROS,
      createdAt: ago(800),
    },
  });
  await prisma.$executeRawUnsafe(
    `UPDATE opportunities SET updated_at = '2019-01-01T00:00:00.000Z' WHERE id = $1::uuid`,
    oldOpen.id,
  );
  await prisma.opportunity.create({
    data: {
      orgId: org.orgId,
      companyId: hugeId,
      code: `${TAG}-huge`,
      customer: `${TAG} Huge`,
      name: 'Open total past one number',
      stage: 's2_sent',
      valueMicros: TEN_BN_MICROS,
      createdAt: ago(10),
    },
  });
  server = await buildServer();
  await server.ready();
}, 120_000);

afterAll(async () => {
  await server?.close();
  restoreAuth?.();
  if (org.orgId) {
    invalidateAccessScope(org.orgId);
    await dropIsolatedOrg(org.orgId);
  }
});

const get = (url: string) => server.inject({ method: 'GET', url: `/api/v1${url}` });

describe('open pipeline total', () => {
  it('counts an open deal that the latest 500 page dropped, and puts the sample phrase on the 24-month counts', async () => {
    // WHY: ordering the page by updatedAt drops a long-untouched open deal,
    // so the tile total is the page, not the book. The spoken line then
    // tacks "among the latest 500 deals" onto "in the last 24 months".
    const positioning = await get(`/accounts/${crowdedId}/positioning`);
    expect(positioning.statusCode, positioning.body).toBe(200);
    const body = positioning.json<AccountPositioning>();
    const text = spoken(body.brief);
    expect(body.brief.pipeline.openCount).toBe(1);
    expect(body.brief.pipeline.openMicros).toBe(OLD_OPEN_MICROS.toString());
    expect(text).toContain('1 open deal worth EUR 5');
    expect(text).toContain('among the latest 500 deals, 500 won and 0 lost in the last 24 months');
    expect(text).not.toContain('months among the latest 500 deals');

    const numbers = await get(`/accounts/${crowdedId}/key-numbers`);
    expect(numbers.statusCode, numbers.body).toBe(200);
    const pipeline = numbers.json<AccountKeyNumbers>().items.find((item) => item.id === 'pipeline');
    expect(pipeline).toMatchObject({ value: Number(OLD_OPEN_MICROS), unit: 'money_micros', missing: null });
    expect(pipeline?.sub).toBe('1 open deal');
    expect(pipeline?.sub).not.toContain('latest');
  });

  it('shows a 10bn open total on the tile, the same figure the brief already says', async () => {
    // WHY: micros past the safe integer made the tile say "No data" while the
    // brief still said EUR 10.0bn. The amount fits once it is currency units.
    const positioning = await get(`/accounts/${hugeId}/positioning`);
    expect(positioning.statusCode, positioning.body).toBe(200);
    const brief = spoken(positioning.json<AccountPositioning>().brief);
    expect(brief).toContain('EUR 10.0bn');

    const numbers = await get(`/accounts/${hugeId}/key-numbers`);
    expect(numbers.statusCode, numbers.body).toBe(200);
    const pipeline = numbers.json<AccountKeyNumbers>().items.find((item) => item.id === 'pipeline');
    expect(pipeline).toMatchObject({
      value: 10_000_000_000,
      unit: 'money',
      currency: 'EUR',
      missing: null,
    });
  });
});
