import { afterAll, beforeAll, describe, expect } from 'vitest';

import { prisma } from '@bidstack/db';

import {
  createIsolatedOrg,
  dropIsolatedOrg,
  useIsolatedOrgAuth,
} from '../test-support/isolated-org.js';
import { makeSkipIfNoDb } from '../test-support/skip-if-no-db.js';
import { buildMeetingContext } from './ai-assistant.context.js';

let dbReachable = false;
let orgId = '';
let ownerId = '';
let restoreAuth: (() => void) | null = null;

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    dbReachable = false;
    return;
  }
  const iso = await createIsolatedOrg('meeting-brief');
  orgId = iso.orgId;
  restoreAuth = useIsolatedOrgAuth(iso.clerkOrg);
  const owner = await prisma.user.findFirstOrThrow({
    where: { orgId },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  ownerId = owner.id;
});

afterAll(async () => {
  restoreAuth?.();
  if (orgId) await dropIsolatedOrg(orgId);
  if (dbReachable) await prisma.$disconnect();
});

const skipIfNoDb = makeSkipIfNoDb(() => dbReachable);

describe('meeting brief open deals', () => {
  skipIfNoDb('a lost stage flag is not an open deal in the brief', async () => {
    // WHY: the brief listed any deal that was not stored as closed_lost.
    // A stage marked lost, or a won deal, was still handed to the model as open.
    const stamp = Date.now();
    const pipeline = await prisma.pipeline.create({
      data: { orgId, name: `Brief ${stamp}` },
    });
    const lost = await prisma.pipelineStage.create({
      data: { orgId, pipelineId: pipeline.id, key: 'price_lost', name: 'Price lost', isLost: true },
    });
    const deal = await prisma.opportunity.create({
      data: {
        orgId,
        code: `OP-BR-${stamp}`,
        customer: 'Brief Co',
        name: 'Looks open',
        stage: 's2_sent',
        pipelineStageId: lost.id,
        valueMicros: 1_000_000n,
        probability: 40,
        intel: {},
      },
    });
    const event = await prisma.calendarEvent.create({
      data: {
        orgId,
        ownerId,
        provider: 'google_workspace',
        subject: `Prep ${stamp}`,
        startAt: new Date('2026-11-02T15:00:00.000Z'),
        endAt: new Date('2026-11-02T15:30:00.000Z'),
        relatedEntityId: deal.id,
      },
    });
    try {
      const lostBrief = await buildMeetingContext(orgId, event.id);
      expect(lostBrief.openOpps).toEqual([]);

      await prisma.pipelineStage.update({
        where: { id: lost.id },
        data: { deletedAt: new Date() },
      });
      const reopened = await buildMeetingContext(orgId, event.id);
      expect(reopened.openOpps.map((row) => row.id)).toEqual([deal.id]);
      expect(reopened.openOpps[0]?.stage).toBe('S2 Sent');
      expect(reopened.openOpps[0]?.stage).not.toBe('Price lost');
    } finally {
      await prisma.calendarEvent.deleteMany({ where: { id: event.id } });
      await prisma.opportunity.deleteMany({ where: { id: deal.id } });
      await prisma.pipelineStage.deleteMany({ where: { pipelineId: pipeline.id } });
      await prisma.pipeline.delete({ where: { id: pipeline.id } });
    }
  });

  skipIfNoDb('a company link lists that company\'s open deals and leaves a lost deal out', async () => {
    // WHY: the brief treated every related id as one opportunity. A company
    // id then looked like a meeting with no open deals, and a long book
    // would have been presented as the whole list.
    const stamp = Date.now();
    const company = await prisma.company.create({
      data: { orgId, name: `Brief Co ${stamp}` },
    });
    const other = await prisma.company.create({
      data: { orgId, name: `Other Co ${stamp}` },
    });
    const pipeline = await prisma.pipeline.create({
      data: { orgId, name: `Brief book ${stamp}` },
    });
    const lostStage = await prisma.pipelineStage.create({
      data: { orgId, pipelineId: pipeline.id, key: 'price_lost', name: 'Price lost', isLost: true },
    });
    const openStage = await prisma.pipelineStage.create({
      data: { orgId, pipelineId: pipeline.id, key: 's2_sent', name: 'S2 Sent' },
    });
    const lost = await prisma.opportunity.create({
      data: {
        orgId,
        companyId: company.id,
        code: `OP-BL-${stamp}`,
        customer: 'Brief Co',
        name: 'Lost flag',
        stage: 's2_sent',
        pipelineStageId: lostStage.id,
        valueMicros: 9_000_000n,
        probability: 80,
        intel: {},
        updatedAt: new Date('2026-11-01T12:00:00.000Z'),
      },
    });
    const opens = await Promise.all(
      Array.from({ length: 6 }, (_, index) =>
        prisma.opportunity.create({
          data: {
            orgId,
            companyId: company.id,
            code: `OP-BO-${stamp}-${index}`,
            customer: 'Brief Co',
            name: `Open ${index}`,
            stage: 's2_sent',
            pipelineStageId: openStage.id,
            valueMicros: 1_000_000n,
            probability: 40,
            intel: {},
            updatedAt: new Date(Date.UTC(2026, 10, 1, 11, index)),
          },
        }),
      ),
    );
    const elsewhere = await prisma.opportunity.create({
      data: {
        orgId,
        companyId: other.id,
        code: `OP-BX-${stamp}`,
        customer: 'Other Co',
        name: 'Other open',
        stage: 's2_sent',
        pipelineStageId: openStage.id,
        valueMicros: 1_000_000n,
        probability: 40,
        intel: {},
      },
    });
    const event = await prisma.calendarEvent.create({
      data: {
        orgId,
        ownerId,
        provider: 'google_workspace',
        subject: `Company prep ${stamp}`,
        startAt: new Date('2026-11-02T15:00:00.000Z'),
        endAt: new Date('2026-11-02T15:30:00.000Z'),
        relatedEntityType: 'company',
        relatedEntityId: company.id,
      },
    });
    try {
      const brief = await buildMeetingContext(orgId, event.id);
      expect(brief.openOpps.map((row) => row.id)).toEqual(
        [...opens].reverse().slice(0, 5).map((row) => row.id),
      );
      expect(brief.openOppsOmitted).toBe(1);
      expect(brief.openOpps[0]?.stage).toBe('S2 Sent');
      expect(brief.openOpps[0]?.stage).not.toBe('s2_sent');
      expect(brief.openOpps.map((row) => row.id)).not.toContain(lost.id);
      expect(brief.openOpps.map((row) => row.id)).not.toContain(elsewhere.id);
    } finally {
      await prisma.calendarEvent.deleteMany({ where: { id: event.id } });
      await prisma.opportunity.deleteMany({
        where: { id: { in: [lost.id, elsewhere.id, ...opens.map((row) => row.id)] } },
      });
      await prisma.pipelineStage.deleteMany({ where: { pipelineId: pipeline.id } });
      await prisma.pipeline.delete({ where: { id: pipeline.id } });
      await prisma.company.deleteMany({ where: { id: { in: [company.id, other.id] } } });
    }
  });
});
