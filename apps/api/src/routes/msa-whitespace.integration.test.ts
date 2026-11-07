/**
 * Ranked MSA whitespace, accept / dismiss, and "who works with them"
 * (slice 13b). The seeded Pfizer fixture (global MSA via HEMA, Digital
 * project only) must be the top flag.
 */
import { createHash, randomUUID } from 'node:crypto';

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadAccountActivityLines, prisma } from '@bidstack/db';
import { agentTools } from '@bidstack/db/agent-tools';
import type { WhitespaceFlag } from '@bidstack/shared';

import { invalidateAccessScope } from '../lib/access-scope.js';
import { buildServer } from '../server.js';
import { createIsolatedOrg, dropIsolatedOrg, useIsolatedOrgAuth } from '../test-support/isolated-org.js';

let server: FastifyInstance;
let org = { orgId: '', clerkOrg: '' };
let restoreAuth: (() => void) | null = null;
let pfizerId = '';
let pfizerMsaId = '';
let adminId = '';

type Inj = { method: 'GET' | 'POST'; url: string; payload?: unknown; role?: string; headers?: Record<string, string> };
function call({ method, url, payload, role, headers }: Inj) {
  return server.inject({
    method,
    url: `/api/v1${url}`,
    ...(payload !== undefined ? { payload: payload as object } : {}),
    headers: { ...(role ? { 'x-bidstack-e2e-role': role } : {}), ...(headers ?? {}) },
  });
}

async function makeKey(opts: { companyIds?: string[]; readOnly?: boolean } = {}) {
  const raw = `bs_test_ws_${randomUUID()}`;
  const key = await prisma.apiKey.create({
    data: {
      orgId: org.orgId,
      name: 'Whitespace test key',
      prefix: raw.slice(0, 8),
      hashedKey: createHash('sha256').update(raw).digest('hex'),
      scopes: ['read', 'write'],
      readOnly: opts.readOnly ?? false,
      unrestrictedScope: !opts.companyIds,
      companyIds: opts.companyIds ?? [],
    },
  });
  return { raw, id: key.id };
}

async function pfizerFlag(): Promise<WhitespaceFlag | null> {
  const res = await call({ method: 'GET', url: `/msa/${pfizerMsaId}/whitespace` });
  expect(res.statusCode, res.body).toBe(200);
  return (res.json() as { flag: WhitespaceFlag | null }).flag;
}

beforeAll(async () => {
  process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER = 'true';
  org = await createIsolatedOrg('msa-whitespace');
  restoreAuth = useIsolatedOrgAuth(org.clerkOrg);
  const pfizer = await prisma.company.findFirstOrThrow({ where: { orgId: org.orgId, name: 'Pfizer' } });
  pfizerId = pfizer.id;
  pfizerMsaId = (await prisma.contractAgreement.findFirstOrThrow({ where: { orgId: org.orgId, companyId: pfizerId } })).id;
  adminId = (await prisma.user.findFirstOrThrow({ where: { orgId: org.orgId }, orderBy: { createdAt: 'asc' } })).id;
  server = await buildServer();
  await server.ready();
});

afterAll(async () => {
  await server?.close();
  restoreAuth?.();
  invalidateAccessScope(org.orgId);
  if (org.orgId) await dropIsolatedOrg(org.orgId);
});

describe('GET /msa/whitespace', () => {
  it('ranks Pfizer via HEMA first with every factor cited', async () => {
    const res = await call({ method: 'GET', url: '/msa/whitespace' });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as { items: WhitespaceFlag[]; total: number; byLine: Array<{ line: string }> };
    const top = body.items[0]!;
    expect(top.companyName).toBe('Pfizer');
    expect(top.headline).toBe('Global MSA via HEMA, no IT or Engineering business yet');
    expect(top.score).toBeGreaterThanOrEqual(85);
    expect(top.owner?.id).toBe(adminId);
    const scope = top.factors.find((f) => f.key === 'scope')!;
    expect(scope.citations[0]).toMatchObject({ kind: 'clause', clause: 'Clause 2.1' });
    expect(top.factors.find((f) => f.key === 'intel')!.citations.some((c) => c.url?.includes('pfizer-fixture.example'))).toBe(true);
    const northwind = body.items.find((f) => f.companyName === 'Northwind Pharma');
    expect(northwind).toBeDefined();
    expect(northwind!.score).toBeLessThan(top.score);
    expect(body.byLine.map((b) => b.line)).toEqual(expect.arrayContaining(['it', 'engineering']));
  });

  it('filters by line, entity, country and owner, and caps at the limit', async () => {
    const eng = (await call({ method: 'GET', url: '/msa/whitespace?line=engineering' })).json() as { items: WhitespaceFlag[] };
    expect(eng.items.every((f) => f.lines.includes('engineering'))).toBe(true);
    const hemaId = eng.items[0]!.signingEntity.id;
    const ent = (await call({ method: 'GET', url: `/msa/whitespace?signingEntityId=${hemaId}` })).json() as { items: WhitespaceFlag[] };
    expect(ent.items.every((f) => f.signingEntity.id === hemaId)).toBe(true);
    const de = (await call({ method: 'GET', url: '/msa/whitespace?country=DE' })).json() as { items: WhitespaceFlag[] };
    expect(de.items.some((f) => f.companyName === 'Pfizer')).toBe(true);
    const mine = (await call({ method: 'GET', url: `/msa/whitespace?ownerId=${adminId}` })).json() as { items: WhitespaceFlag[] };
    expect(mine.items.every((f) => f.owner?.id === adminId)).toBe(true);
    const one = (await call({ method: 'GET', url: '/msa/whitespace?limit=1' })).json() as { items: WhitespaceFlag[]; total: number };
    expect(one.items).toHaveLength(1);
    expect(one.total).toBeGreaterThanOrEqual(1);
  });

  it('is readable with msa:read and hidden from other tenants', async () => {
    expect((await call({ method: 'GET', url: '/msa/whitespace', role: 'sdr' })).statusCode).toBe(200);
    const other = await createIsolatedOrg('msa-whitespace-other');
    try {
      const restore = useIsolatedOrgAuth(other.clerkOrg);
      try {
        const flag = await call({ method: 'GET', url: `/msa/${pfizerMsaId}/whitespace` });
        expect(flag.json()).toEqual({ flag: null });
        const map = await call({ method: 'GET', url: `/companies/${pfizerId}/relationship-map` });
        expect(map.statusCode).toBe(404);
      } finally {
        restore();
      }
    } finally {
      await dropIsolatedOrg(other.orgId);
    }
  });
});

describe('GET /msa/whitespace/digest', () => {
  it('returns my top new flags as an email draft and never sends it', async () => {
    const res = await call({ method: 'GET', url: '/msa/whitespace/digest' });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as { week: string; digest: { flags: WhitespaceFlag[]; email: { subject: string; body: string } } };
    expect(body.digest.flags.length).toBeLessThanOrEqual(3);
    expect(body.digest.flags.every((f) => f.owner?.id === adminId)).toBe(true);
    expect(body.digest.email.body).toContain('Pfizer: Global MSA via HEMA, no IT or Engineering business yet');
  });
});

describe('who works with them', () => {
  it('maps entities, affiliates, lines, owners and countries', async () => {
    const res = await call({ method: 'GET', url: `/companies/${pfizerId}/relationship-map` });
    expect(res.statusCode, res.body).toBe(200);
    const map = res.json() as {
      companies: Array<{ name: string; relation: string }>;
      entities: Array<{ slug: string; msaIds: string[] }>;
      people: Array<{ owner: { id: string }; lastActivityAt: string | null }>;
      rows: Array<{ kind: string; line: string | null }>;
      countries: string[];
    };
    expect(map.companies).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'Pfizer Ltd (UK)', relation: 'affiliate' })]));
    expect(map.entities.find((e) => e.slug === 'hema')?.msaIds).toContain(pfizerMsaId);
    expect(map.people.find((p) => p.owner.id === adminId)?.lastActivityAt).toBeTruthy();
    expect(map.rows.some((r) => r.kind === 'project' && r.line === 'digital')).toBe(true);
    expect(map.countries).toEqual(expect.arrayContaining(['US', 'GB']));
  });

  it('a country-restricted user sees only the opportunities they may see, in rows, activity and totals', async () => {
    const teammate = await prisma.user.findFirstOrThrow({ where: { orgId: org.orgId, id: { not: adminId } }, orderBy: { createdAt: 'asc' } });
    const hidden = await prisma.opportunity.create({
      data: {
        orgId: org.orgId,
        code: `WS-HIDDEN-${randomUUID().slice(0, 8)}`,
        customer: 'Pfizer',
        companyId: pfizerId,
        name: 'Secret DE advisory deal',
        stage: 's2_sent',
        ownerId: teammate.id,
        country: 'DE',
        valueMicros: 7_777_000_000n,
      },
    });
    const call_ = await prisma.activity.create({
      data: { orgId: org.orgId, type: 'call', subject: 'Secret DE pricing call', entityType: 'opportunity', entityId: hidden.id, ownerId: teammate.id },
    });
    const group = await prisma.userGroup.create({ data: { orgId: org.orgId, name: `ws-us-${randomUUID().slice(0, 8)}`, scopeCountries: ['US'], scopeAll: false } });
    await prisma.userGroupMember.create({ data: { orgId: org.orgId, userId: adminId, groupId: group.id } });
    invalidateAccessScope(org.orgId, adminId);
    type Map = { rows: Array<{ id: string }>; people: Array<{ owner: { id: string }; totals: Array<{ currency: string; valueMicros: number }> }> };
    const expectHidden = (map: Map) => {
      expect(map.rows.map((r) => r.id)).not.toContain(hidden.id);
      expect(map.rows.map((r) => r.id)).not.toContain(call_.id);
      expect(JSON.stringify(map)).not.toContain('Secret DE');
      const mate = map.people.find((p) => p.owner.id === teammate.id);
      for (const t of mate?.totals ?? []) expect(t.valueMicros).toBeLessThan(7_777_000_000);
    };
    try {
      const res = await call({ method: 'GET', url: `/companies/${pfizerId}/relationship-map` });
      expect(res.statusCode, res.body).toBe(200);
      expectHidden(res.json() as Map);
      const viaTool = (await agentTools.relationship_map.handler({ companyId: pfizerId }, { orgId: org.orgId, userId: adminId })) as Map;
      expectHidden(viaTool);
      await prisma.userGroupMember.deleteMany({ where: { groupId: group.id } });
      invalidateAccessScope(org.orgId, adminId);
      // Unrestricted, the same deal is on the map.
      const open = (await call({ method: 'GET', url: `/companies/${pfizerId}/relationship-map` })).json() as Map;
      expect(open.rows.map((r) => r.id)).toEqual(expect.arrayContaining([hidden.id, call_.id]));
    } finally {
      await prisma.userGroupMember.deleteMany({ where: { groupId: group.id } });
      await prisma.userGroup.delete({ where: { id: group.id } });
      invalidateAccessScope(org.orgId, adminId);
      await prisma.activity.delete({ where: { id: call_.id } });
      await prisma.opportunity.delete({ where: { id: hidden.id } });
    }
  });

  it('keeps person totals per currency and never sums EUR with USD', async () => {
    const sub = await prisma.subscription.create({
      data: {
        orgId: org.orgId,
        accountId: pfizerId,
        planTier: 'Support plan',
        arrAmountMicros: 300_000_000_000n,
        currency: 'USD',
        startedAt: new Date('2026-01-01T00:00:00Z'),
        currentPeriodEnd: new Date('2026-12-31T00:00:00Z'),
        renewalDate: new Date('2026-12-31T00:00:00Z'),
        ownerId: adminId,
      },
    });
    const opp = await prisma.opportunity.create({
      data: { orgId: org.orgId, code: `WS-EUR-${randomUUID().slice(0, 8)}`, customer: 'Pfizer', companyId: pfizerId, name: 'Pfizer support renewal', stage: 's2_sent', ownerId: adminId, valueMicros: 200_000_000_000n },
    });
    try {
      const res = await call({ method: 'GET', url: `/companies/${pfizerId}/relationship-map` });
      expect(res.statusCode, res.body).toBe(200);
      const map = res.json() as { people: Array<{ owner: { id: string }; totals: Array<{ currency: string; valueMicros: number }> }> };
      const me = map.people.find((p) => p.owner.id === adminId)!;
      expect(me).not.toHaveProperty('valueMicros');
      const usd = me.totals.find((t) => t.currency === 'USD');
      const eur = me.totals.find((t) => t.currency === 'EUR');
      expect(usd?.valueMicros).toBe(300_000_000_000);
      expect(eur?.valueMicros).toBeGreaterThanOrEqual(200_000_000_000);
      expect(me.totals.map((t) => t.currency).sort()).toEqual(['EUR', 'USD']);
    } finally {
      await prisma.subscription.delete({ where: { id: sub.id } });
      await prisma.opportunity.delete({ where: { id: opp.id } });
    }
  });

  it('respects a scoped API key', async () => {
    const key = await makeKey({ companyIds: [] });
    const res = await server.inject({ method: 'GET', url: `/api/v1/companies/${pfizerId}/relationship-map`, headers: { 'x-api-key': key.raw } });
    expect(res.statusCode).toBe(404);
  });
});

describe('accept and dismiss', () => {
  it('needs msa:write and a user session', async () => {
    const body = { line: 'it', ownerId: adminId, dueDate: '2026-12-15' };
    expect((await call({ method: 'POST', url: `/msa/${pfizerMsaId}/whitespace/accept`, payload: body, role: 'sdr' })).statusCode).toBe(403);
    const key = await makeKey();
    const viaKey = await server.inject({ method: 'POST', url: `/api/v1/msa/${pfizerMsaId}/whitespace/accept`, headers: { 'x-api-key': key.raw }, payload: body });
    expect(viaKey.statusCode).toBe(403);
    const bad = await call({ method: 'POST', url: `/msa/${pfizerMsaId}/whitespace/dismiss`, payload: { line: 'it', reason: '' } });
    expect(bad.statusCode).toBe(400);
  });

  it('accept creates a cross-sell action and a draft opportunity after a click, then the line leaves the flag', async () => {
    const before = await prisma.crossSellAction.count({ where: { orgId: org.orgId } });
    const res = await call({
      method: 'POST',
      url: `/msa/${pfizerMsaId}/whitespace/accept`,
      payload: { line: 'it', ownerId: adminId, dueDate: '2026-12-15', createOpportunity: true },
    });
    expect(res.statusCode, res.body).toBe(201);
    const out = res.json() as { flag: WhitespaceFlag; crossSellActionId: string; opportunityId: string };
    expect(await prisma.crossSellAction.count({ where: { orgId: org.orgId } })).toBe(before + 1);
    const action = await prisma.crossSellAction.findFirstOrThrow({ where: { id: out.crossSellActionId } });
    expect(action).toMatchObject({ assigneeId: adminId, requestingUnit: 'HEMA', assignedUnit: 'IT' });
    const opp = await prisma.opportunity.findFirstOrThrow({ where: { id: out.opportunityId } });
    expect(opp).toMatchObject({ stage: 's1_lead', companyId: pfizerId, ownerId: adminId });
    expect(out.flag.headline).toBe('Global MSA via HEMA, no Engineering business yet');
    expect(out.flag.decisions).toEqual([expect.objectContaining({ line: 'it', state: 'accepted', crossSellActionId: action.id })]);
    const audit = await prisma.auditLog.findFirst({ where: { orgId: org.orgId, action: 'msa.whitespace.accepted', targetId: pfizerMsaId } });
    expect(audit).not.toBeNull();
    const again = await call({ method: 'POST', url: `/msa/${pfizerMsaId}/whitespace/accept`, payload: { line: 'it', ownerId: adminId, dueDate: '2026-12-15' } });
    expect(again.statusCode).toBe(409);
  });

  it('an accepted opportunity is left out only while it is still a lead', async () => {
    const decision = await prisma.msaWhitespaceDecision.findFirstOrThrow({ where: { orgId: org.orgId, contractId: pfizerMsaId, line: 'it', state: 'accepted' } });
    const before = (await loadAccountActivityLines(prisma, org.orgId, [pfizerId])).get(pfizerId)!;
    expect(before.opportunityLines).not.toContain('it');
    await prisma.opportunity.update({ where: { id: decision.opportunityId! }, data: { stage: 's2_sent' } });
    try {
      const after = (await loadAccountActivityLines(prisma, org.orgId, [pfizerId])).get(pfizerId)!;
      expect(after.opportunityLines).toContain('it');
    } finally {
      await prisma.opportunity.update({ where: { id: decision.opportunityId! }, data: { stage: 's1_lead' } });
    }
  });

  it('the seeded HSBC Cybersecurity Transformation counts as IT business', async () => {
    const hsbc = await prisma.company.findFirstOrThrow({ where: { orgId: org.orgId, name: 'HSBC' } });
    expect(await prisma.opportunity.count({ where: { orgId: org.orgId, companyId: hsbc.id, name: 'Cybersecurity Transformation' } })).toBe(1);
    const lines = (await loadAccountActivityLines(prisma, org.orgId, [hsbc.id])).get(hsbc.id)!;
    expect(lines.opportunityLines).toContain('it');
  });

  it('dismiss hides a line for 90 days unless the evidence changes', async () => {
    const res = await call({ method: 'POST', url: `/msa/${pfizerMsaId}/whitespace/dismiss`, payload: { line: 'engineering', reason: 'Client runs engineering in house' } });
    expect(res.statusCode, res.body).toBe(200);
    const flag = (res.json() as { flag: WhitespaceFlag }).flag;
    expect(flag.state).toBe('accepted');
    const audit = await prisma.auditLog.findFirst({ where: { orgId: org.orgId, action: 'msa.whitespace.dismissed', targetId: pfizerMsaId } });
    expect(audit?.diff).toMatchObject({ line: 'engineering', reason: 'Client runs engineering in house' });
    const list = (await call({ method: 'GET', url: '/msa/whitespace' })).json() as { items: WhitespaceFlag[] };
    expect(list.items.some((f) => f.msaId === pfizerMsaId)).toBe(false);
    expect((await call({ method: 'POST', url: `/msa/${pfizerMsaId}/whitespace/dismiss`, payload: { line: 'engineering', reason: 'again please' } })).statusCode).toBe(400);

    // New evidence in the line brings it back.
    await prisma.companyPost.create({
      data: {
        orgId: org.orgId,
        companyId: pfizerId,
        source: 'fixture',
        externalId: `ws-${randomUUID()}`,
        title: 'Pfizer opens new manufacturing automation plant',
        excerpt: 'Fixture',
        kind: 'expansion',
        fetchedAt: new Date(),
        sample: true,
      },
    });
    const back = await pfizerFlag();
    expect(back?.state).toBe('new');
    expect(back?.lines).toEqual(['engineering']);
  });

  it('a dismissal older than 90 days no longer hides the line', async () => {
    const msa = await prisma.contractAgreement.findFirstOrThrow({ where: { orgId: org.orgId, reference: 'NW-PHARMA-MSA-2026' } });
    const flag = ((await call({ method: 'GET', url: `/msa/${msa.id}/whitespace` })).json() as { flag: WhitespaceFlag }).flag;
    const line = flag.lines[0]!;
    await call({ method: 'POST', url: `/msa/${msa.id}/whitespace/dismiss`, payload: { line, reason: 'Not now' } });
    const hidden = ((await call({ method: 'GET', url: `/msa/${msa.id}/whitespace` })).json() as { flag: WhitespaceFlag }).flag;
    expect(hidden.lines).not.toContain(line);
    await prisma.msaWhitespaceDecision.updateMany({
      where: { orgId: org.orgId, contractId: msa.id, line },
      data: { decidedAt: new Date(Date.now() - 91 * 86_400_000) },
    });
    const shown = ((await call({ method: 'GET', url: `/msa/${msa.id}/whitespace` })).json() as { flag: WhitespaceFlag }).flag;
    expect(shown.lines).toContain(line);
  });
});

describe('concurrent accept', () => {
  it('two clicks at once create one cross-sell action', async () => {
    const msa = await prisma.contractAgreement.findFirstOrThrow({ where: { orgId: org.orgId, reference: 'NW-PHARMA-MSA-2026' } });
    const flag = ((await call({ method: 'GET', url: `/msa/${msa.id}/whitespace` })).json() as { flag: WhitespaceFlag }).flag;
    const line = flag.lines[0]!;
    const before = await prisma.crossSellAction.count({ where: { orgId: org.orgId } });
    const body = { line, ownerId: adminId, dueDate: '2026-12-15' };
    const res = await Promise.all([1, 2].map(() => call({ method: 'POST', url: `/msa/${msa.id}/whitespace/accept`, payload: body })));
    expect(res.map((r) => r.statusCode).sort()).toEqual([201, 409]);
    expect(await prisma.crossSellAction.count({ where: { orgId: org.orgId } })).toBe(before + 1);
  });
  it('a dismissal racing an accept takes the same MSA lock, rechecks, and loses', async () => {
    const msa = await prisma.contractAgreement.findFirstOrThrow({ where: { orgId: org.orgId, reference: 'NW-PHARMA-MSA-2026' } });
    await prisma.msaWhitespaceDecision.deleteMany({ where: { orgId: org.orgId, contractId: msa.id } });
    const flag = ((await call({ method: 'GET', url: `/msa/${msa.id}/whitespace` })).json() as { flag: WhitespaceFlag }).flag;
    const line = flag.lines[0]!;
    const lockWaiters = async () =>
      Number(
        (await prisma.$queryRaw<Array<{ n: bigint }>>`SELECT count(*)::bigint AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`)[0]!.n,
      );
    const until = async (check: () => Promise<boolean>) => {
      for (let i = 0; i < 100 && !(await check()); i += 1) await new Promise((r) => setTimeout(r, 50));
    };

    // Hold the MSA row so the accept is parked inside its transaction, then
    // dismiss while it waits: the order a real double submit can produce.
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let held!: () => void;
    const holding = new Promise<void>((r) => (held = r));
    const holder = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM contract_agreements WHERE id = ${msa.id}::uuid FOR UPDATE`;
        held();
        await gate;
      },
      { timeout: 20_000 },
    );
    await holding;
    const accepting = call({ method: 'POST', url: `/msa/${msa.id}/whitespace/accept`, payload: { line, ownerId: adminId, dueDate: '2026-12-15' } });
    await until(async () => (await lockWaiters()) >= 1);
    let dismissDone = false;
    const dismissing = call({ method: 'POST', url: `/msa/${msa.id}/whitespace/dismiss`, payload: { line, reason: 'Race check' } }).then((r) => {
      dismissDone = true;
      return r;
    });
    await until(async () => dismissDone || (await lockWaiters()) >= 2);
    release();
    await holder;
    const [accept, dismiss] = await Promise.all([accepting, dismissing]);

    // The accept queued for the row first, so it wins and the dismissal,
    // which read the flag before the accept committed, must see it and stop.
    expect(accept.statusCode, accept.body).toBe(201);
    expect(dismiss.statusCode, dismiss.body).toBe(409);
    const decisions = await prisma.msaWhitespaceDecision.findMany({
      where: { orgId: org.orgId, contractId: msa.id, line },
      orderBy: { decidedAt: 'desc' },
    });
    expect(decisions.map((d) => d.state)).toEqual(['accepted']);
    const after = ((await call({ method: 'GET', url: `/msa/${msa.id}/whitespace` })).json() as { flag: WhitespaceFlag }).flag;
    expect(after.decisions.find((d) => d.line === line)?.state).toBe('accepted');
  });
});

describe('agent tools', () => {
  it('msa_whitespace and relationship_map answer inside the caller scope', async () => {
    const out = (await agentTools.msa_whitespace.handler({ limit: 5 }, { orgId: org.orgId, userId: adminId })) as {
      items: Array<{ company: string; factors: unknown[] }>;
    };
    expect(out.items.length).toBeGreaterThan(0);
    expect(out.items[0]!.factors.length).toBe(7);
    const map = (await agentTools.relationship_map.handler({ companyName: 'Pfizer' }, { orgId: org.orgId, userId: adminId })) as {
      entities: Array<{ slug: string }>;
    };
    expect(map.entities.some((e) => e.slug === 'hema')).toBe(true);
    const key = await makeKey({ companyIds: [] });
    await expect(
      agentTools.relationship_map.handler({ companyId: pfizerId }, { orgId: org.orgId, keyId: key.id } as never),
    ).rejects.toThrow(/not found/i);
    const scoped = (await agentTools.msa_whitespace.handler({ limit: 5 }, { orgId: org.orgId, keyId: key.id } as never)) as { items: unknown[] };
    expect(scoped.items).toHaveLength(0);
  });
});
