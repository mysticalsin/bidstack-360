// Org chart routes: RBAC (orgchart:read / Admin-only orgchart:write),
// cross-tenant and scope isolation (404), hierarchy redaction, cycle
// rejection, optimistic concurrency (409), root rules, delete reparenting,
// node detail from meeting intel, coverage overlay and audit.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { prisma } from '@bidstack/db';

import { invalidateAccessScope } from '../lib/access-scope.js';
import { clearRbacDecisionCacheForTest } from '../lib/rbac-decision-cache.js';
import { buildServer } from '../server.js';
import { createIsolatedOrg, dropIsolatedOrg, useIsolatedOrgAuth } from '../test-support/isolated-org.js';

const TAG = `oc${Date.now()}`;
let server: FastifyInstance;
let orgA = { orgId: '', clerkOrg: '' };
let orgB = { orgId: '', clerkOrg: '' };
let restoreAuth: (() => void) | null = null;
let prevRoleHeader: string | undefined;
let adminId = '';
const c: Record<string, string> = {};
const p: Record<string, string> = {};
const n: Record<string, string> = {};
let foreignNode = '';

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';
function call(method: Method, url: string, opts: { payload?: unknown; role?: string } = {}) {
  return server.inject({
    method,
    url: `/api/v1${url}`,
    ...(opts.payload !== undefined ? { payload: opts.payload as object } : {}),
    headers: opts.role ? { 'x-bidstack-e2e-role': opts.role } : {},
  });
}
const tree = async () => (await call('GET', `/companies/${c.root}/org-chart`)).json();
const nodeVersion = async (id: string) => (await prisma.orgChartNode.findUniqueOrThrow({ where: { id } })).version;
const chartVersion = async () => (await prisma.orgChart.findFirstOrThrow({ where: { companyId: c.root } })).version;

async function withScope(userId: string, countries: string[], fn: () => Promise<void>) {
  const group = await prisma.userGroup.create({ data: { orgId: orgA.orgId, name: `${TAG}-${countries.join('')}`, scopeCountries: countries } });
  await prisma.userGroupMember.create({ data: { orgId: orgA.orgId, groupId: group.id, userId } });
  invalidateAccessScope(orgA.orgId, userId);
  try {
    await fn();
  } finally {
    await prisma.userGroupMember.deleteMany({ where: { groupId: group.id } });
    await prisma.userGroup.delete({ where: { id: group.id } });
    invalidateAccessScope(orgA.orgId, userId);
  }
}

beforeAll(async () => {
  prevRoleHeader = process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER;
  process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER = 'true';
  clearRbacDecisionCacheForTest();
  orgA = await createIsolatedOrg('oc-a');
  orgB = await createIsolatedOrg('oc-b');
  restoreAuth = useIsolatedOrgAuth(orgA.clerkOrg);
  adminId = (await prisma.user.findFirstOrThrow({ where: { orgId: orgA.orgId }, orderBy: { createdAt: 'asc' } })).id;
  const mk = async (k: string, data: Record<string, unknown>, orgId = orgA.orgId) =>
    (c[k] = (await prisma.company.create({ data: { orgId, ...data } as never })).id);
  await mk('root', { name: `${TAG} Acme Group`, countryCode: 'FR' });
  await mk('fr', { name: `${TAG} Acme France`, parentId: c.root, countryCode: 'FR' });
  await mk('de', { name: `${TAG} Acme Germany`, parentId: c.root, countryCode: 'DE' });
  await mk('other', { name: `${TAG} Unrelated`, countryCode: 'FR' });
  await mk('b', { name: `${TAG} Other org`, countryCode: 'FR' }, orgB.orgId);
  const person = async (k: string, data: Record<string, unknown>, orgId = orgA.orgId) =>
    (p[k] = (await prisma.contact.create({ data: { orgId, customer: 'Acme', ...data } as never })).id);
  await person('ceo', { name: 'Ada Ceo', role: 'Chief Executive Officer', companyId: c.root, email: `ceo@${TAG}.test` });
  await person('cfo', { name: 'Marie Curie', role: 'CFO', companyId: c.fr, reportsToContactId: p.ceo });
  await person('hans', { name: 'Hans Vogel', role: 'VP Sales DACH', companyId: c.de });
  await person('stranger', { name: 'Not Ours', role: 'CTO', companyId: c.other });
  await person('foreign', { name: 'Other Org', role: 'CEO', companyId: c.b }, orgB.orgId);
  await prisma.meetingIntel.create({
    data: {
      orgId: orgA.orgId,
      companyId: c.fr!,
      title: `${TAG} QBR`,
      heldAt: new Date('2026-10-20T14:00:00Z'),
      visibility: 'org',
      dedupeKey: `${TAG}-qbr`.padEnd(20, 'x'),
      challenges: ['Legacy ERP', 'Hiring freeze'],
      nextSteps: ['Send deck'],
      sources: { create: [{ orgId: orgA.orgId, source: 'abc', externalId: `${TAG}-qbr` }] },
      attendees: { create: [{ orgId: orgA.orgId, name: 'Marie Curie', title: 'CFO', seniority: 'c_level', contactId: p.cfo }, { orgId: orgA.orgId, name: 'Admin', isInternal: true, userId: adminId }] },
    },
  });
  const chartB = await prisma.orgChart.create({ data: { orgId: orgB.orgId, companyId: c.b! } });
  foreignNode = (await prisma.orgChartNode.create({ data: { orgId: orgB.orgId, chartId: chartB.id, name: 'Foreign CEO', contactId: p.foreign } })).id;
  server = await buildServer();
  await server.ready();
});

afterAll(async () => {
  await server?.close();
  restoreAuth?.();
  if (prevRoleHeader === undefined) delete process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER;
  else process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER = prevRoleHeader;
  invalidateAccessScope(orgA.orgId);
  if (orgA.orgId) await dropIsolatedOrg(orgA.orgId);
  if (orgB.orgId) await dropIsolatedOrg(orgB.orgId);
});

describe('building the chart', () => {
  it('starts empty, the first node is the root and later nodes need a parent', async () => {
    expect(await tree()).toEqual({ companyId: c.root, chart: null, nodes: [], truncated: false });
    const ceo = await call('POST', `/companies/${c.root}/org-chart/nodes`, { payload: { contactId: p.ceo } });
    expect(ceo.statusCode, ceo.body).toBe(201);
    expect(ceo.json().node).toMatchObject({ name: 'Ada Ceo', title: 'Chief Executive Officer', seniority: 'c_level', placement: 'root', parentId: null, kind: 'contact', version: 1 });
    n.ceo = ceo.json().node.id;
    expect(ceo.json().node.provenance.name.source).toBe('contacts');

    const orphan = await call('POST', `/companies/${c.root}/org-chart/nodes`, { payload: { name: 'COO' } });
    expect(orphan.statusCode).toBe(400);
    const cfo = await call('POST', `/companies/${c.root}/org-chart/nodes`, { payload: { contactId: p.cfo, parentId: n.ceo, relationshipStrength: 4, sentiment: 'warm', ownerUserId: adminId } });
    expect(cfo.statusCode, cfo.body).toBe(201);
    n.cfo = cfo.json().node.id;
    expect(cfo.json().node.owner).toMatchObject({ id: adminId });
    n.hans = (await call('POST', `/companies/${c.root}/org-chart/nodes`, { payload: { contactId: p.hans, parentId: n.cfo } })).json().node.id;
    const ph = await call('POST', `/companies/${c.root}/org-chart/nodes`, { payload: { name: 'Head of Procurement', title: 'Head of Procurement', parentId: n.cfo, function: 'procurement' } });
    expect(ph.json().node).toMatchObject({ kind: 'placeholder', contactId: null, seniority: 'vp' });
    n.proc = ph.json().node.id;
  });

  it('rejects duplicate contacts, contacts of other accounts and other orgs', async () => {
    expect((await call('POST', `/companies/${c.root}/org-chart/nodes`, { payload: { contactId: p.cfo, parentId: n.ceo } })).statusCode).toBe(409);
    expect((await call('POST', `/companies/${c.root}/org-chart/nodes`, { payload: { contactId: p.stranger, parentId: n.ceo } })).statusCode).toBe(400);
    expect((await call('POST', `/companies/${c.root}/org-chart/nodes`, { payload: { contactId: p.foreign, parentId: n.ceo } })).statusCode).toBe(400);
    expect((await call('POST', `/companies/${c.root}/org-chart/nodes`, { payload: { name: 'X', parentId: foreignNode } })).statusCode).toBe(404);
  });

  it('serves the tree parents first, with depth limits and counts', async () => {
    const t = await tree();
    expect(t.chart).toMatchObject({ rootNodeId: n.ceo, nodeCount: 4 });
    expect(t.nodes.map((x: { id: string }) => x.id)).toEqual([n.ceo, n.cfo, n.hans, n.proc]);
    expect(t.nodes[1]).toMatchObject({ depth: 1, childCount: 2, meetingCount: 1, lastMetAt: '2026-10-20T14:00:00.000Z' });
    const shallow = (await call('GET', `/companies/${c.root}/org-chart?depth=0`)).json();
    expect(shallow.nodes).toHaveLength(1);
    expect(shallow.truncated).toBe(true);
    const sub = (await call('GET', `/companies/${c.root}/org-chart?fromNodeId=${n.cfo}&depth=1`)).json();
    expect(sub.nodes.map((x: { id: string }) => x.id)).toEqual([n.cfo, n.hans, n.proc]);
    expect(sub.nodes[0].depth).toBe(1);
  });
});

describe('RBAC', () => {
  it('lets read-only users read but not write; only Admin writes by default', async () => {
    clearRbacDecisionCacheForTest();
    expect((await call('GET', `/companies/${c.root}/org-chart`, { role: 'read-only' })).statusCode).toBe(200);
    expect((await call('GET', `/org-chart/nodes/${n.cfo}`, { role: 'read-only' })).statusCode).toBe(200);
    for (const role of ['read-only', 'sales-manager']) {
      expect((await call('POST', `/companies/${c.root}/org-chart/nodes`, { role, payload: { name: 'X', parentId: n.ceo } })).statusCode).toBe(403);
      expect((await call('PATCH', `/org-chart/nodes/${n.cfo}`, { role, payload: { version: 1, title: 'X' } })).statusCode).toBe(403);
      expect((await call('POST', `/org-chart/nodes/${n.hans}/move`, { role, payload: { version: 1, parentId: n.ceo } })).statusCode).toBe(403);
      expect((await call('DELETE', `/org-chart/nodes/${n.proc}?version=1`, { role })).statusCode).toBe(403);
      expect((await call('POST', `/companies/${c.root}/org-chart/root`, { role, payload: { nodeId: n.cfo, chartVersion: 1 } })).statusCode).toBe(403);
    }
    clearRbacDecisionCacheForTest();
  });
});

describe('isolation and redaction', () => {
  it('answers 404 across tenants', async () => {
    expect((await call('GET', `/companies/${c.b}/org-chart`)).statusCode).toBe(404);
    expect((await call('GET', `/org-chart/nodes/${foreignNode}`)).statusCode).toBe(404);
    expect((await call('PATCH', `/org-chart/nodes/${foreignNode}`, { payload: { version: 1, name: 'pwned' } })).statusCode).toBe(404);
    expect((await call('DELETE', `/org-chart/nodes/${foreignNode}?version=1`)).statusCode).toBe(404);
    expect((await prisma.orgChartNode.findUniqueOrThrow({ where: { id: foreignNode } })).name).toBe('Foreign CEO');
  });

  it('redacts nodes on out-of-scope subsidiaries and hides out-of-scope accounts', async () => {
    await withScope(adminId, ['FR'], async () => {
      const t = await tree();
      const hans = t.nodes.find((x: { id: string }) => x.id === n.hans);
      expect(hans).toMatchObject({ name: 'Restricted', title: null, contactId: null, redacted: true, seniority: 'vp', parentId: n.cfo });
      expect((await call('GET', `/org-chart/nodes/${n.hans}`)).statusCode).toBe(404);
      expect((await call('PATCH', `/org-chart/nodes/${n.hans}`, { payload: { version: 1, title: 'x' } })).statusCode).toBe(404);
      expect((await call('POST', `/org-chart/nodes/${n.proc}/move`, { payload: { version: 1, parentId: n.hans } })).statusCode).toBe(404);
      const detail = (await call('GET', `/org-chart/nodes/${n.cfo}`)).json();
      expect(detail.directReports.find((r: { id: string }) => r.id === n.hans)).toMatchObject({ name: 'Restricted', redacted: true });
    });
    await withScope(adminId, ['DE'], async () => {
      expect((await call('GET', `/companies/${c.root}/org-chart`)).statusCode).toBe(404);
      expect((await call('GET', `/org-chart/nodes/${n.hans}`)).statusCode).toBe(404);
    });
  });
});

describe('editing', () => {
  it('rejects cycles and moving the root', async () => {
    const v = await nodeVersion(n.cfo);
    const cyc = await call('POST', `/org-chart/nodes/${n.cfo}/move`, { payload: { version: v, parentId: n.hans } });
    expect(cyc.statusCode, cyc.body).toBe(422);
    expect((await call('POST', `/org-chart/nodes/${n.cfo}/move`, { payload: { version: v, parentId: n.cfo } })).statusCode).toBe(422);
    expect((await call('POST', `/org-chart/nodes/${n.ceo}/move`, { payload: { version: 1, parentId: n.cfo } })).statusCode).toBe(400);
  });

  it('moves a node and bumps both versions', async () => {
    const before = await chartVersion();
    const res = await call('POST', `/org-chart/nodes/${n.proc}/move`, { payload: { version: await nodeVersion(n.proc), parentId: n.ceo, sortOrder: 2 } });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().node).toMatchObject({ parentId: n.ceo, placement: 'manual', sortOrder: 2 });
    expect(res.json().chartVersion).toBe(before + 1);
  });

  it('answers 409 with current versions on stale node or chart versions', async () => {
    const v = await nodeVersion(n.cfo);
    expect((await call('PATCH', `/org-chart/nodes/${n.cfo}`, { payload: { version: v, title: 'Group CFO', region: 'EMEA' } })).statusCode).toBe(200);
    const stale = await call('PATCH', `/org-chart/nodes/${n.cfo}`, { payload: { version: v, title: 'Clobber' } });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({ error: 'version_conflict', currentVersion: v + 1 });
    const staleChart = await call('POST', `/companies/${c.root}/org-chart/nodes`, { payload: { name: 'Late', parentId: n.ceo, chartVersion: 1 } });
    expect(staleChart.statusCode).toBe(409);
    expect(staleChart.json().chartVersion).toBe(await chartVersion());
    const node = await prisma.orgChartNode.findUniqueOrThrow({ where: { id: n.cfo } });
    expect(node.title).toBe('Group CFO');
    expect((node.provenance as Record<string, { source: string }>).title!.source).toBe('manual');
  });

  it('sets a new root by placing the old root under it', async () => {
    const res = await call('POST', `/companies/${c.root}/org-chart/root`, { payload: { nodeId: n.cfo, chartVersion: await chartVersion() } });
    expect(res.statusCode, res.body).toBe(200);
    let t = await tree();
    expect(t.chart.rootNodeId).toBe(n.cfo);
    expect(t.nodes.find((x: { id: string }) => x.id === n.ceo).parentId).toBe(n.cfo);
    expect((await call('POST', `/companies/${c.root}/org-chart/root`, { payload: { nodeId: n.ceo, chartVersion: 1 } })).statusCode).toBe(409);
    expect((await call('POST', `/companies/${c.root}/org-chart/root`, { payload: { nodeId: n.ceo, chartVersion: await chartVersion() } })).statusCode).toBe(200);
    t = await tree();
    expect(t.chart.rootNodeId).toBe(n.ceo);
    expect(t.nodes.find((x: { id: string }) => x.id === n.cfo).parentId).toBe(n.ceo);
  });

  it('soft deletes a node and moves its reports up; the CEO with reports stays', async () => {
    expect((await call('DELETE', `/org-chart/nodes/${n.ceo}?version=${await nodeVersion(n.ceo)}`)).statusCode).toBe(409);
    const res = await call('DELETE', `/org-chart/nodes/${n.cfo}?version=${await nodeVersion(n.cfo)}`);
    expect(res.statusCode, res.body).toBe(200);
    const t = await tree();
    expect(t.nodes.map((x: { id: string }) => x.id)).not.toContain(n.cfo);
    expect(t.nodes.find((x: { id: string }) => x.id === n.hans).parentId).toBe(n.ceo);
    expect((await prisma.orgChartNode.findFirst({ where: { id: n.cfo }, select: { id: true } }))).toBeNull();
    // The contact can be added back once its node is deleted.
    const again = await call('POST', `/companies/${c.root}/org-chart/nodes`, { payload: { contactId: p.cfo, parentId: n.ceo } });
    expect(again.statusCode, again.body).toBe(201);
    n.cfo = again.json().node.id;
  });
});

describe('node detail and coverage', () => {
  it('returns meetings, challenges, path and the reports-to fact', async () => {
    const res = await call('GET', `/org-chart/nodes/${n.cfo}`);
    expect(res.statusCode, res.body).toBe(200);
    const d = res.json();
    expect(d.manager).toMatchObject({ id: n.ceo, name: 'Ada Ceo' });
    expect(d.path.map((x: { id: string }) => x.id)).toEqual([n.ceo, n.cfo]);
    expect(d.meetings).toHaveLength(1);
    expect(d.meetings[0]).toMatchObject({ title: `${TAG} QBR`, sources: ['abc'], nextSteps: ['Send deck'] });
    expect(d.challenges.map((x: { text: string }) => x.text).sort()).toEqual(['Hiring freeze', 'Legacy ERP']);
    expect(d.reportsToFact).toEqual({ contactId: p.ceo, name: 'Ada Ceo', matchesChart: true });
  });

  it('marks which nodes were met in the window', async () => {
    const cov = (await call('GET', `/companies/${c.root}/org-chart/coverage?windowDays=3650`)).json();
    expect(cov).toMatchObject({ total: 4, met: 1 });
    expect(cov.nodes.find((x: { nodeId: string }) => x.nodeId === n.cfo)).toMatchObject({ met: true, meetingCount: 1 });
    expect(cov.unmetSenior).toEqual(expect.arrayContaining([n.ceo, n.hans]));
    expect(cov.bySeniority.find((b: { seniority: string }) => b.seniority === 'c_level')).toEqual({ seniority: 'c_level', total: 2, met: 1 });
  });
});

describe('audit', () => {
  it('records every change', async () => {
    const rows = await prisma.auditLog.findMany({ where: { orgId: orgA.orgId, action: { startsWith: 'orgchart.' } }, select: { action: true, userId: true }, take: 200 });
    const actions = new Set(rows.map((r) => r.action));
    for (const a of ['orgchart.node.create', 'orgchart.node.update', 'orgchart.node.move', 'orgchart.node.delete', 'orgchart.root.set', 'orgchart.node.view']) expect(actions).toContain(a);
    expect(rows.filter((r) => r.action !== 'orgchart.node.view').every((r) => r.userId === adminId)).toBe(true);
  });
});
