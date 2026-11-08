import { afterAll, beforeAll, describe, expect } from 'vitest';

import { prisma } from '@bidstack/db';
import { microsToUnits } from '@bidstack/shared';

import { createIsolatedOrg, dropIsolatedOrg } from '../../test-support/isolated-org.js';
import { makeSkipIfNoDb } from '../../test-support/skip-if-no-db.js';
import { getPipelineKpis } from './funnel.service.js';

let dbReachable = false;
let orgId = '';

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    dbReachable = false;
    return;
  }
  orgId = (await createIsolatedOrg('weighted')).orgId;
});

afterAll(async () => {
  if (orgId) await dropIsolatedOrg(orgId);
  if (dbReachable) await prisma.$disconnect();
});

const skipIfNoDb = makeSkipIfNoDb(() => dbReachable);

// Same micros the export test uses: naive Number(bigint)/1e6 rounds to .19.
const MONEY_MICROS = 8_598_204_328_457_184_962n;

describe('weighted pipeline keeps large amounts exact', () => {
  skipIfNoDb('a value past the float mantissa stays on the exact cent', async () => {
    // WHY: the weighted total divided float micros before the sum was converted.
    // This amount then read one cent high.
    const before = await getPipelineKpis(orgId);
    const deal = await prisma.opportunity.create({
      data: {
        orgId,
        code: `OP-WT-${Date.now()}`,
        customer: 'Wide Book',
        name: 'Large open',
        stage: 's1_lead',
        valueMicros: MONEY_MICROS,
        probability: 100,
        intel: {},
      },
    });
    try {
      const after = await getPipelineKpis(orgId);
      const expected = microsToUnits(((MONEY_MICROS + 5_000n) / 10_000n) * 10_000n);
      const delta = after.weightedPipeline - before.weightedPipeline;
      expect(delta).toBeCloseTo(expected, 2);
      expect(expected.toFixed(2)).toBe('8598204328457.18');
    } finally {
      await prisma.opportunity.delete({ where: { id: deal.id } });
    }
  });
});
