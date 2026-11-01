import { afterAll, beforeAll, describe, expect } from 'vitest';

import { prisma } from '@bidstack/db';

import { createIsolatedOrg, dropIsolatedOrg } from '../../test-support/isolated-org.js';
import { makeSkipIfNoDb } from '../../test-support/skip-if-no-db.js';
import { fetchAccountPerformance } from './dashboard.queries.js';
import { normalizeName } from './dashboard.utils.js';

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
  const iso = await createIsolatedOrg('account-performance');
  orgId = iso.orgId;
}, 30_000);

afterAll(async () => {
  if (orgId) await dropIsolatedOrg(orgId);
  if (dbReachable) await prisma.$disconnect();
});

const skipIfNoDb = makeSkipIfNoDb(() => dbReachable);

describe('account win/loss counts a flagged stage', () => {
  skipIfNoDb('a lost flag is a loss and a won flag is revenue', async () => {
    // WHY: the account chart grouped by the enum key. A stage marked lost
    // while the key still looked open never appeared as a loss.
    const name = `Perf Co ${Date.now()}`;
    const company = await prisma.company.create({ data: { orgId, name } });
    const pipeline = await prisma.pipeline.create({
      data: { orgId, name: `${name} pipeline` },
    });
    const lost = await prisma.pipelineStage.create({
      data: { orgId, pipelineId: pipeline.id, key: 'price_lost', name: 'Price lost', isLost: true },
    });
    const won = await prisma.pipelineStage.create({
      data: { orgId, pipelineId: pipeline.id, key: 'verbal_won', name: 'Verbal won', isWon: true },
    });
    const both = await prisma.pipelineStage.create({
      data: {
        orgId,
        pipelineId: pipeline.id,
        key: 'both_flags',
        name: 'Both',
        isWon: true,
        isLost: true,
      },
    });
    await prisma.opportunity.createMany({
      data: [
        {
          orgId,
          code: `OP-PF1-${Date.now()}`,
          customer: name,
          companyId: company.id,
          name: 'Enum won',
          stage: 'closed_won',
          valueMicros: 1_000_000n,
          probability: 100,
          dueDate: new Date('2026-01-15'),
          intel: {},
        },
        {
          orgId,
          code: `OP-PF2-${Date.now()}`,
          customer: name,
          companyId: company.id,
          name: 'Flagged won',
          stage: 's3_technical_iteration',
          pipelineStageId: won.id,
          valueMicros: 2_000_000n,
          probability: 80,
          dueDate: new Date('2026-03-15'),
          intel: {},
        },
        {
          orgId,
          code: `OP-PF3-${Date.now()}`,
          customer: name,
          companyId: company.id,
          name: 'Flagged lost',
          stage: 's2_sent',
          pipelineStageId: lost.id,
          valueMicros: 9_000_000n,
          probability: 40,
          dueDate: new Date('2026-02-15'),
          intel: {},
        },
        {
          orgId,
          code: `OP-PF4-${Date.now()}`,
          customer: name,
          companyId: company.id,
          name: 'Both flags',
          stage: 's4_negotiation',
          pipelineStageId: both.id,
          valueMicros: 4_000_000n,
          probability: 50,
          dueDate: new Date('2026-03-20'),
          intel: {},
        },
      ],
    });

    const result = await fetchAccountPerformance(orgId, company.id, prisma);
    expect(result.winLoss).toEqual({
      wonCount: 2,
      lostCount: 2,
      wonValueMicros: '3000000',
      lostValueMicros: '13000000',
      winRate: 50,
    });
    expect(result.revenueEvolution).toEqual([
      { period: '2026-01', revenueMicros: '1000000' },
      { period: '2026-03', revenueMicros: '2000000' },
    ]);
  });
});

describe('account book for a customer slug', () => {
  skipIfNoDb('counts deals with a null company id by customer key', async () => {
    // WHY: a customer-only account id is normalizeName(customer). Filtering
    // company_id with that slug threw or returned an empty book.
    const stamp = Date.now();
    const customer = `Key Only Clinic ${stamp}`;
    const slug = normalizeName(customer);
    const pipeline = await prisma.pipeline.create({
      data: { orgId, name: `${customer} pipeline` },
    });
    const lost = await prisma.pipelineStage.create({
      data: { orgId, pipelineId: pipeline.id, key: 'price_lost', name: 'Price lost', isLost: true },
    });
    const won = await prisma.pipelineStage.create({
      data: { orgId, pipelineId: pipeline.id, key: 'verbal_won', name: 'Verbal won', isWon: true },
    });
    const both = await prisma.pipelineStage.create({
      data: {
        orgId,
        pipelineId: pipeline.id,
        key: 'both_flags',
        name: 'Both',
        isWon: true,
        isLost: true,
      },
    });
    const open = await prisma.opportunity.create({
      data: {
        orgId,
        code: `OP-CK-OPEN-${stamp}`,
        customer,
        companyId: null,
        name: 'Open bid',
        stage: 's2_sent',
        valueMicros: 5_000_000n,
        probability: 40,
        intel: {},
      },
    });
    const other = await prisma.opportunity.create({
      data: {
        orgId,
        code: `OP-CK-OTHER-${stamp}`,
        customer: `Other Clinic ${stamp}`,
        companyId: null,
        name: 'Other bid',
        stage: 'closed_won',
        valueMicros: 50_000_000n,
        probability: 100,
        dueDate: new Date('2026-01-20'),
        intel: {},
      },
    });
    await prisma.opportunity.createMany({
      data: [
        {
          orgId,
          code: `OP-CK-W1-${stamp}`,
          customer,
          companyId: null,
          name: 'Enum won',
          stage: 'closed_won',
          valueMicros: 1_000_000n,
          probability: 100,
          dueDate: new Date('2026-01-15'),
          intel: {},
        },
        {
          orgId,
          code: `OP-CK-W2-${stamp}`,
          customer,
          companyId: null,
          name: 'Flagged won',
          stage: 's3_technical_iteration',
          pipelineStageId: won.id,
          valueMicros: 2_000_000n,
          probability: 80,
          dueDate: new Date('2026-03-15'),
          intel: {},
        },
        {
          orgId,
          code: `OP-CK-L1-${stamp}`,
          customer,
          companyId: null,
          name: 'Flagged lost',
          stage: 's2_sent',
          pipelineStageId: lost.id,
          valueMicros: 9_000_000n,
          probability: 40,
          intel: {},
        },
        {
          orgId,
          code: `OP-CK-L2-${stamp}`,
          customer,
          companyId: null,
          name: 'Both flags',
          stage: 's4_negotiation',
          pipelineStageId: both.id,
          valueMicros: 4_000_000n,
          probability: 50,
          dueDate: new Date('2026-03-20'),
          intel: {},
        },
        {
          orgId,
          code: `OP-CK-PUNCT-${stamp}`,
          customer: `  key   only clinic ${stamp}! `,
          companyId: null,
          name: 'Punctuated open',
          stage: 's1_lead',
          valueMicros: 6_000_000n,
          probability: 10,
          intel: {},
        },
        {
          orgId,
          code: `OP-CK-DEL-${stamp}`,
          customer,
          companyId: null,
          name: 'Deleted won',
          stage: 'closed_won',
          valueMicros: 8_000_000n,
          probability: 100,
          dueDate: new Date('2026-04-01'),
          deletedAt: new Date(),
          intel: {},
        },
        {
          orgId,
          code: `OP-CK-BLANK-${stamp}`,
          customer: '---',
          companyId: null,
          name: 'Blank customer',
          stage: 'closed_won',
          valueMicros: 7_000_000n,
          probability: 100,
          dueDate: new Date('2026-05-01'),
          intel: {},
        },
      ],
    });
    await prisma.task.create({
      data: { orgId, oppId: open.id, title: 'Book the review' },
    });
    await prisma.task.create({
      data: { orgId, oppId: other.id, title: 'Not this book' },
    });
    const unrelated = await prisma.company.create({ data: { orgId, name: `Not ${customer}` } });
    await prisma.task.create({
      data: { orgId, accountId: unrelated.id, title: 'Company task, not the slug book' },
    });
    await prisma.contact.create({
      data: { orgId, customer, name: 'Pat', companyId: null },
    });

    const result = await fetchAccountPerformance(orgId, slug, prisma);
    expect(result.winLoss).toEqual({
      wonCount: 2,
      lostCount: 2,
      wonValueMicros: '3000000',
      lostValueMicros: '13000000',
      winRate: 50,
    });
    expect(result.book).toEqual({
      projectCount: 6,
      openCount: 2,
      contactCount: 0,
      taskCount: 1,
    });
    expect(result.revenueEvolution).toEqual([
      { period: '2026-01', revenueMicros: '1000000' },
      { period: '2026-03', revenueMicros: '2000000' },
    ]);

    const blank = await fetchAccountPerformance(orgId, '', prisma);
    expect(blank).toEqual({
      winLoss: {
        wonCount: 0,
        lostCount: 0,
        wonValueMicros: '0',
        lostValueMicros: '0',
        winRate: null,
      },
      revenueEvolution: [],
      book: { projectCount: 0, openCount: 0, contactCount: 0, taskCount: 0 },
    });
  });
});
