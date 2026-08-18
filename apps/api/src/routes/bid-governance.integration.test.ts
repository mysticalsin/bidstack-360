// Integration coverage for the Amaris Bid Office governance surface:
// classification persistence, gate-decision validation, the stage gate, the
// Presales→Bid Office handoff, and the Stage-10 Lessons Learned obligation.
//
// WHY these specific cases: each one pins a bypass or gap that was live in the
// shipped feature. A gate that accepts a mismatched outcome, a class that
// accepts a gate it does not own, a killed bid that reaches negotiation via
// close-then-reopen, a handoff recorded twice, and a close that raised no
// debrief obligation are all *silent* failures — the request 200s and the
// governance record simply lies. Only an integration test catches them.
import { afterAll, beforeAll, describe, expect } from 'vitest';
import { randomUUID } from 'node:crypto';

import { prisma } from '@bidstack/db';

import { buildServer } from '../server.js';
import {
  createIsolatedOrg,
  dropIsolatedOrg,
  useIsolatedOrgAuth,
} from '../test-support/isolated-org.js';
import { makeSkipIfNoDb } from '../test-support/skip-if-no-db.js';

let server: Awaited<ReturnType<typeof buildServer>>;
let dbReachable = false;
let orgId: string | null = null;
let restoreAuth: (() => void) | null = null;
let foreignOrgId: string | null = null;
const stageIdByKey = new Map<string, string>();

async function makeOpp(org: string, stage = 's1_lead', pipelineStageId?: string) {
  return prisma.opportunity.create({
    data: {
      orgId: org,
      code: `GOV-${randomUUID().slice(0, 8)}`,
      customer: 'Governance Test Co',
      name: `Gov bid ${randomUUID().slice(0, 6)}`,
      stage: stage as never,
      pipelineStageId: pipelineStageId ?? null,
      valueMicros: 1_000_000n,
      probability: 10,
    },
  });
}

/** Force the org's effective gate mode without restarting the server. */
async function setGateMode(mode: 'off' | 'warn' | 'enforce') {
  await prisma.orgSettings.upsert({
    where: { orgId: orgId! },
    create: { orgId: orgId!, stageGateMode: mode },
    update: { stageGateMode: mode },
  });
}

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    dbReachable = false;
    return;
  }
  const org = await createIsolatedOrg('bidgov');
  orgId = org.orgId;
  restoreAuth = useIsolatedOrgAuth(org.clerkOrg);

  const foreign = await prisma.org.create({
    data: { clerkOrg: `org_bidgov_foreign_${randomUUID().slice(0, 8)}`, name: 'Foreign Org' },
  });
  foreignOrgId = foreign.id;

  // seedOrgData creates no Pipeline, so build one explicitly: the handoff and
  // the pipeline-backed gate path both need real PipelineStage rows.
  const pipeline = await prisma.pipeline.create({
    data: { orgId: org.orgId, name: 'Gov Test Pipeline', isDefault: true },
  });
  const stageSpec = [
    { key: 's1_lead', name: 'Lead', orderIndex: 0 },
    { key: 's1_ongoing', name: 'Ongoing', orderIndex: 1 },
    { key: 's2_sent', name: 'Sent', orderIndex: 2 },
    { key: 's3_technical_iteration', name: 'Technical', orderIndex: 3 },
    { key: 's4_negotiation', name: 'Negotiation', orderIndex: 4 },
    { key: 'closed_won', name: 'Won', orderIndex: 5, isWon: true },
    { key: 'closed_lost', name: 'Lost', orderIndex: 6, isLost: true },
  ];
  for (const s of stageSpec) {
    const row = await prisma.pipelineStage.create({
      data: { orgId: org.orgId, pipelineId: pipeline.id, ...s },
    });
    stageIdByKey.set(s.key, row.id);
  }

  server = await buildServer();
  await server.ready();
}, 60_000);

afterAll(async () => {
  if (server) await server.close();
  if (restoreAuth) restoreAuth();
  if (foreignOrgId) await prisma.org.delete({ where: { id: foreignOrgId } }).catch(() => undefined);
  if (orgId) await dropIsolatedOrg(orgId);
  if (dbReachable) await prisma.$disconnect();
});

const t = makeSkipIfNoDb(() => dbReachable && !!orgId);

describe('POST /opportunities/:id/classification', () => {
  t('computes the class server-side from FTE x commitment and persists all three fields', async () => {
    const opp = await makeOpp(orgId!);
    const res = await server.inject({
      method: 'POST',
      url: `/api/v1/opportunities/${opp.id}/classification`,
      // 45 FTE = Game Changer, xhigh commitment -> C4 per the playbook matrix.
      payload: { fteEstimate: 45, commitmentLevel: 'xhigh' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ bidClass: 'C4', sizeBand: 'GC' });

    const row = await prisma.opportunity.findUniqueOrThrow({ where: { id: opp.id } });
    expect(row.bidClass).toBe('C4');
    expect(row.fteEstimate).toBe(45);
    expect(row.commitmentLevel).toBe('xhigh');
  });

  t('reclassifies down when the inputs shrink (the class is derived, never sticky)', async () => {
    const opp = await makeOpp(orgId!);
    await server.inject({
      method: 'POST',
      url: `/api/v1/opportunities/${opp.id}/classification`,
      payload: { fteEstimate: 45, commitmentLevel: 'xhigh' },
    });
    const res = await server.inject({
      method: 'POST',
      url: `/api/v1/opportunities/${opp.id}/classification`,
      payload: { fteEstimate: 2, commitmentLevel: 'low' },
    });
    expect(res.json()).toMatchObject({ bidClass: 'C1', sizeBand: 'S' });
  });

  t('404s on another org opportunity instead of writing across the tenant boundary', async () => {
    const foreign = await makeOpp(foreignOrgId!);
    const res = await server.inject({
      method: 'POST',
      url: `/api/v1/opportunities/${foreign.id}/classification`,
      payload: { fteEstimate: 10, commitmentLevel: 'high' },
    });
    expect(res.statusCode).toBe(404);
    const row = await prisma.opportunity.findUniqueOrThrow({ where: { id: foreign.id } });
    expect(row.bidClass).toBeNull();
  });
});

describe('POST /opportunities/:id/gate-decisions', () => {
  t('rejects an outcome the gate cannot decide (400)', async () => {
    const opp = await makeOpp(orgId!);
    const res = await server.inject({
      method: 'POST',
      url: `/api/v1/opportunities/${opp.id}/gate-decisions`,
      // 'approved' on a Go/No-Go maps to NO standing-decision signal. Stored,
      // it would be the newest go_no_go row and would hide a prior no-go.
      payload: { gate: 'go_no_go', outcome: 'approved' },
    });
    expect(res.statusCode).toBe(400);
    const rows = await prisma.gateDecision.count({ where: { orgId: orgId!, opportunityId: opp.id } });
    expect(rows).toBe(0);
  });

  t('rejects a gate that does not belong to the bid class (409)', async () => {
    const opp = await makeOpp(orgId!);
    await server.inject({
      method: 'POST',
      url: `/api/v1/opportunities/${opp.id}/classification`,
      payload: { fteEstimate: 3, commitmentLevel: 'low' }, // -> C1
    });
    const res = await server.inject({
      method: 'POST',
      url: `/api/v1/opportunities/${opp.id}/gate-decisions`,
      payload: { gate: 'strategy_validation', outcome: 'approved' }, // C4-only gate
    });
    expect(res.statusCode).toBe(409);
  });

  t('accepts any gate while the opportunity is unclassified', async () => {
    const opp = await makeOpp(orgId!);
    const res = await server.inject({
      method: 'POST',
      url: `/api/v1/opportunities/${opp.id}/gate-decisions`,
      payload: { gate: 'strategy_validation', outcome: 'approved' },
    });
    expect(res.statusCode).toBe(200);
  });

  t('records a valid decision and lists it back, stamped with the class', async () => {
    const opp = await makeOpp(orgId!);
    await server.inject({
      method: 'POST',
      url: `/api/v1/opportunities/${opp.id}/classification`,
      payload: { fteEstimate: 3, commitmentLevel: 'low' },
    });
    const create = await server.inject({
      method: 'POST',
      url: `/api/v1/opportunities/${opp.id}/gate-decisions`,
      payload: { gate: 'go_no_go', outcome: 'go', justification: 'Strategic logo' },
    });
    expect(create.statusCode).toBe(200);

    const list = await server.inject({
      method: 'GET',
      url: `/api/v1/opportunities/${opp.id}/gate-decisions`,
    });
    const items = (list.json() as { items: { gate: string; outcome: string; bidClass: string }[] })
      .items;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ gate: 'go_no_go', outcome: 'go', bidClass: 'C1' });
  });
});

describe('stage gate (enforce mode)', () => {
  t('blocks forward advancement of an opportunity with a standing no-go', async () => {
    await setGateMode('enforce');
    const opp = await makeOpp(orgId!, 's1_lead', stageIdByKey.get('s1_lead'));
    await server.inject({
      method: 'POST',
      url: `/api/v1/opportunities/${opp.id}/gate-decisions`,
      payload: { gate: 'go_no_go', outcome: 'no_go', justification: 'Out of scope' },
    });
    const res = await server.inject({
      method: 'POST',
      url: `/api/v1/opportunities/${opp.id}/stage`,
      payload: { pipelineStageId: stageIdByKey.get('s1_ongoing') },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().message).toContain('no-bid/no-go');
  });

  t('allows a one-step move when no negative decision stands', async () => {
    await setGateMode('enforce');
    const opp = await makeOpp(orgId!, 's1_lead', stageIdByKey.get('s1_lead'));
    const res = await server.inject({
      method: 'POST',
      url: `/api/v1/opportunities/${opp.id}/stage`,
      payload: { pipelineStageId: stageIdByKey.get('s1_ongoing') },
    });
    expect(res.statusCode).toBe(200);
  });

  t('blocks a multi-stage jump', async () => {
    await setGateMode('enforce');
    const opp = await makeOpp(orgId!, 's1_lead', stageIdByKey.get('s1_lead'));
    const res = await server.inject({
      method: 'POST',
      url: `/api/v1/opportunities/${opp.id}/stage`,
      payload: { pipelineStageId: stageIdByKey.get('s4_negotiation') },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().message).toContain('illegal stage jump');
  });

  // REGRESSION — the close-then-reopen laundering bypass. Both moves were
  // individually "legal and not forward", so a bid with a recorded no-go could
  // reach negotiation in two allowed requests while enforce mode was ON.
  t('blocks reopening a closed bid that still carries a no-go', async () => {
    await setGateMode('enforce');
    const opp = await makeOpp(orgId!, 's1_lead', stageIdByKey.get('s1_lead'));
    await server.inject({
      method: 'POST',
      url: `/api/v1/opportunities/${opp.id}/gate-decisions`,
      payload: { gate: 'go_no_go', outcome: 'no_go' },
    });
    const close = await server.inject({
      method: 'POST',
      url: `/api/v1/opportunities/${opp.id}/stage`,
      payload: { pipelineStageId: stageIdByKey.get('closed_lost') },
    });
    expect(close.statusCode).toBe(200); // abandoning a no-go bid is always allowed

    const reopen = await server.inject({
      method: 'POST',
      url: `/api/v1/opportunities/${opp.id}/stage`,
      payload: { pipelineStageId: stageIdByKey.get('s4_negotiation') },
    });
    expect(reopen.statusCode).toBe(409);
  });

  t('lets the move through in off mode', async () => {
    await setGateMode('off');
    const opp = await makeOpp(orgId!, 's1_lead', stageIdByKey.get('s1_lead'));
    await server.inject({
      method: 'POST',
      url: `/api/v1/opportunities/${opp.id}/gate-decisions`,
      payload: { gate: 'go_no_go', outcome: 'no_go' },
    });
    const res = await server.inject({
      method: 'POST',
      url: `/api/v1/opportunities/${opp.id}/stage`,
      payload: { pipelineStageId: stageIdByKey.get('s4_negotiation') },
    });
    expect(res.statusCode).toBe(200);
  });
});

describe('Presales → Bid Office handoff', () => {
  // BID_OFFICE_ENTRY_ORDER defaults to 2, so s2_sent (orderIndex 2) is the
  // boundary: a move from orderIndex 1 into it activates the Bid Office.
  t('records exactly one handoff when the boundary is crossed, and never again', async () => {
    await setGateMode('off');
    const opp = await makeOpp(orgId!, 's1_ongoing', stageIdByKey.get('s1_ongoing'));
    const move = await server.inject({
      method: 'POST',
      url: `/api/v1/opportunities/${opp.id}/stage`,
      payload: { pipelineStageId: stageIdByKey.get('s2_sent') },
    });
    expect(move.statusCode).toBe(200);

    // The handoff write is fire-and-forget (it must not fail the move), so poll
    // briefly rather than asserting on a race.
    const handoffs = await waitForHandoffs(opp.id, 1);
    expect(handoffs).toBe(1);

    // Step back out and cross again — the record is a one-time activation.
    await server.inject({
      method: 'POST',
      url: `/api/v1/opportunities/${opp.id}/stage`,
      payload: { pipelineStageId: stageIdByKey.get('s1_ongoing') },
    });
    await server.inject({
      method: 'POST',
      url: `/api/v1/opportunities/${opp.id}/stage`,
      payload: { pipelineStageId: stageIdByKey.get('s2_sent') },
    });
    const after = await waitForHandoffs(opp.id, 1);
    expect(after).toBe(1);
  });

  t('does not record a handoff for a move that stays outside the Bid Office zone', async () => {
    await setGateMode('off');
    const opp = await makeOpp(orgId!, 's1_lead', stageIdByKey.get('s1_lead'));
    await server.inject({
      method: 'POST',
      url: `/api/v1/opportunities/${opp.id}/stage`,
      payload: { pipelineStageId: stageIdByKey.get('s1_ongoing') },
    });
    await new Promise((r) => setTimeout(r, 300));
    const count = await prisma.gateDecision.count({
      where: { orgId: orgId!, opportunityId: opp.id, gate: 'bid_office_handoff' },
    });
    expect(count).toBe(0);
  });
});

describe('Stage 10 — Lessons Learned obligation', () => {
  t('raises a dated debrief task on close, once', async () => {
    await setGateMode('off');
    const opp = await makeOpp(orgId!, 's4_negotiation', stageIdByKey.get('s4_negotiation'));
    const res = await server.inject({
      method: 'POST',
      url: `/api/v1/opportunities/${opp.id}/stage`,
      payload: { pipelineStageId: stageIdByKey.get('closed_won') },
    });
    expect(res.statusCode).toBe(200);

    const tasks = await prisma.task.findMany({
      where: { orgId: orgId!, oppId: opp.id, type: 'lessons_learned', deletedAt: null },
    });
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.dueDate).not.toBeNull();
    // 5 business days out is always between 5 and 7 calendar days.
    const days = Math.round(
      (tasks[0]!.dueDate!.getTime() - Date.now()) / (24 * 60 * 60 * 1000),
    );
    expect(days).toBeGreaterThanOrEqual(5);
    expect(days).toBeLessThanOrEqual(7);

    // Reopen and re-close: the obligation is not duplicated.
    await server.inject({
      method: 'POST',
      url: `/api/v1/opportunities/${opp.id}/stage`,
      payload: { pipelineStageId: stageIdByKey.get('s4_negotiation') },
    });
    await server.inject({
      method: 'POST',
      url: `/api/v1/opportunities/${opp.id}/stage`,
      payload: { pipelineStageId: stageIdByKey.get('closed_lost') },
    });
    const again = await prisma.task.count({
      where: { orgId: orgId!, oppId: opp.id, type: 'lessons_learned', deletedAt: null },
    });
    expect(again).toBe(1);
  });

  t('raises nothing while the opportunity is still open', async () => {
    await setGateMode('off');
    const opp = await makeOpp(orgId!, 's1_lead', stageIdByKey.get('s1_lead'));
    await server.inject({
      method: 'POST',
      url: `/api/v1/opportunities/${opp.id}/stage`,
      payload: { pipelineStageId: stageIdByKey.get('s1_ongoing') },
    });
    const count = await prisma.task.count({
      where: { orgId: orgId!, oppId: opp.id, type: 'lessons_learned', deletedAt: null },
    });
    expect(count).toBe(0);
  });
});

/** Poll for the fire-and-forget handoff write; returns the observed count. */
async function waitForHandoffs(opportunityId: string, expected: number): Promise<number> {
  let count = 0;
  for (let i = 0; i < 25; i += 1) {
    count = await prisma.gateDecision.count({
      where: { orgId: orgId!, opportunityId, gate: 'bid_office_handoff' },
    });
    if (count >= expected) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  return count;
}
