import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '@bidstack/db';

import { openDeadlineScanWhere } from './bid-deadline-alerts.helpers.js';

const hasDb = !!process.env.DATABASE_URL;
const describeDb = hasDb ? describe : describe.skip;

describeDb('deadline scan skips a decided stage', () => {
  let orgId = '';

  beforeAll(async () => {
    const org = await prisma.org.create({
      data: { clerkOrg: `org_deadline_${Date.now()}`, name: 'Deadline flags' },
    });
    orgId = org.id;
  });

  afterAll(async () => {
    if (orgId) await prisma.org.delete({ where: { id: orgId } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  it('does not alert a lost or won flag when the stage key still looks open', async () => {
    // WHY: the hourly scan used the enum alone. A stage marked lost still
    // paged the owner that the bid was about to close.
    const owner = await prisma.user.create({
      data: {
        orgId,
        clerkUser: `user_dl_${Date.now()}`,
        email: `deadline.${Date.now()}@test.local`,
        name: 'Deadline Owner',
      },
    });
    const pipeline = await prisma.pipeline.create({
      data: { orgId, name: `Deadline ${Date.now()}` },
    });
    const lost = await prisma.pipelineStage.create({
      data: { orgId, pipelineId: pipeline.id, key: 'price_lost', name: 'Price lost', isLost: true },
    });
    const won = await prisma.pipelineStage.create({
      data: { orgId, pipelineId: pipeline.id, key: 'verbal_won', name: 'Verbal won', isWon: true },
    });
    const due = new Date();
    due.setUTCDate(due.getUTCDate() + 1);
    due.setUTCHours(0, 0, 0, 0);
    const stamp = Date.now();
    const open = await prisma.opportunity.create({
      data: {
        orgId,
        code: `OP-DL1-${stamp}`,
        customer: 'Deadline Co',
        name: 'Still open',
        stage: 's2_sent',
        valueMicros: 1_000_000n,
        probability: 40,
        ownerId: owner.id,
        dueDate: due,
        intel: {},
      },
    });
    const lostOpp = await prisma.opportunity.create({
      data: {
        orgId,
        code: `OP-DL2-${stamp}`,
        customer: 'Deadline Co',
        name: 'Flagged lost',
        stage: 's2_sent',
        pipelineStageId: lost.id,
        valueMicros: 9_000_000n,
        probability: 40,
        ownerId: owner.id,
        dueDate: due,
        intel: {},
      },
    });
    const wonOpp = await prisma.opportunity.create({
      data: {
        orgId,
        code: `OP-DL3-${stamp}`,
        customer: 'Deadline Co',
        name: 'Flagged won',
        stage: 's4_negotiation',
        pipelineStageId: won.id,
        valueMicros: 2_000_000n,
        probability: 80,
        ownerId: owner.id,
        dueDate: due,
        intel: {},
      },
    });

    const start = new Date(due.getTime() - 2 * 86_400_000);
    const end = new Date(due.getTime() + 2 * 86_400_000);
    const rows = await prisma.opportunity.findMany({
      where: { orgId, ...openDeadlineScanWhere({ start, end }) },
      select: { id: true },
    });
    const ids = rows.map((row) => row.id);
    expect(ids).toContain(open.id);
    expect(ids).not.toContain(lostOpp.id);
    expect(ids).not.toContain(wonOpp.id);
  });
});
