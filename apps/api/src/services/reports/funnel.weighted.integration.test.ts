// Weighted pipeline casts value_micros to float8 before dividing. Past 2^53
// micros the product is already the wrong number of micros, then cent rounding
// hides the fraction the book actually stored.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '@bidstack/db';
import { microsToUnits } from '@bidstack/shared';

import { getPipelineKpis } from './funnel.service.js';

// 2^53 + 1. float8 cannot represent this integer. Probability 100 keeps the
// weighted amount equal to the stored micros.
const EXACT_MICROS = 9007199254740993n;

let dbReachable = false;
let orgId = '';

describe('weighted pipeline exact micros', () => {
  beforeAll(async () => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      dbReachable = true;
    } catch {
      dbReachable = false;
      return;
    }
    const org = await prisma.org.create({
      data: { clerkOrg: `org_weight_${Date.now()}`, name: 'Harbor Synthetic Co' },
    });
    orgId = org.id;
    await prisma.opportunity.create({
      data: {
        orgId: org.id,
        code: 'OP-9001',
        customer: 'Harbor Synthetic Co',
        name: 'Exact weight',
        stage: 's1_lead',
        valueMicros: EXACT_MICROS,
        probability: 100,
        industry: 'logistics',
      },
    });
  });

  afterAll(async () => {
    if (orgId) await prisma.org.delete({ where: { id: orgId } }).catch(() => undefined);
  });

  it('weights one open deal as its exact micros', async () => {
    if (!dbReachable) throw new Error('[skip] weighted pipeline — DATABASE_URL not reachable');
    const kpis = await getPipelineKpis(orgId);
    expect(kpis.weightedPipeline).toBe(microsToUnits(EXACT_MICROS));
  });
});
