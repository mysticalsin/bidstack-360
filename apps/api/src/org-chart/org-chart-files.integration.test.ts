// Org chart CSV import (all or nothing, cycles, managers, dry run, update on
// re-import, RBAC, chart version) and node photos (presign, magic bytes,
// size, key binding, serving).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { prisma } from '@bidstack/db';

import { invalidateAccessScope } from '../lib/access-scope.js';
import { clearRbacDecisionCacheForTest } from '../lib/rbac-decision-cache.js';
import { buildServer } from '../server.js';
import { __setStorageForTest } from '../storage/index.js';
import { createIsolatedOrg, dropIsolatedOrg, useIsolatedOrgAuth } from '../test-support/isolated-org.js';
import { makeFakeStorage, type FakeStorage } from '../test-support/msa-storage.js';
import { detectPhotoType } from '../routes/org-chart-files.js';

const TAG = `ocf${Date.now()}`;
let server: FastifyInstance;
let orgA = { orgId: '', clerkOrg: '' };
let restoreAuth: (() => void) | null = null;
let prevRoleHeader: string | undefined;
let adminId = '';
let adminEmail = '';
let storage: FakeStorage;
const c: Record<string, string> = {};
const p: Record<string, string> = {};

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('fake-png-body')]);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

function call(method: 'GET' | 'POST', url: string, opts: { payload?: unknown; role?: string } = {}) {
  return server.inject({
    method,
    url: `/api/v1${url}`,
    ...(opts.payload !== undefined ? { payload: opts.payload as object } : {}),
    headers: opts.role ? { 'x-bidstack-e2e-role': opts.role } : {},
  });
}
const importCsv = (csv: string, extra: Record<string, unknown> = {}, role?: string) =>
  call('POST', `/companies/${c.acme}/org-chart/import`, { payload: { csv, ...extra }, ...(role ? { role } : {}) });
const HEADER = 'name,title,email,manager_email,manager_name,owner_email,relationship_strength';
const liveCount = () => prisma.orgChartNode.count({ where: { orgId: orgA.orgId, deletedAt: null } });

beforeAll(async () => {
  prevRoleHeader = process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER;
  process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER = 'true';
  clearRbacDecisionCacheForTest();
  orgA = await createIsolatedOrg('ocf-a');
  restoreAuth = useIsolatedOrgAuth(orgA.clerkOrg);
  const admin = await prisma.user.findFirstOrThrow({ where: { orgId: orgA.orgId }, orderBy: { createdAt: 'asc' } });
  adminId = admin.id;
  adminEmail = admin.email;
  c.acme = (await prisma.company.create({ data: { orgId: orgA.orgId, name: `${TAG} Acme`, countryCode: 'FR' } })).id;
  const person = async (k: string, name: string, role: string, email: string) =>
    (p[k] = (await prisma.contact.create({ data: { orgId: orgA.orgId, customer: 'Acme', companyId: c.acme, name, role, email } })).id);
  await person('ceo', 'Ada Ceo', 'CEO', `ada@${TAG}.test`);
  await person('cfo', 'Marie Curie', 'CFO', `marie@${TAG}.test`);
  server = await buildServer();
  await server.ready();
});

afterAll(async () => {
  __setStorageForTest(null);
  await server?.close();
  restoreAuth?.();
  if (prevRoleHeader === undefined) delete process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER;
  else process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER = prevRoleHeader;
  invalidateAccessScope(orgA.orgId);
  if (orgA.orgId) await dropIsolatedOrg(orgA.orgId);
});

beforeEach(() => {
  storage = makeFakeStorage('s3');
  __setStorageForTest(storage);
});

describe('CSV import', () => {
  const good = () =>
    [
      HEADER,
      `Ada Ceo,Chief Executive Officer,ada@${TAG}.test,,,,`,
      `Marie Curie,CFO,marie@${TAG}.test,ada@${TAG}.test,,${adminEmail},4`,
      `"Dupont, Jean",Head of IT,,,Marie Curie,,`,
    ].join('\n');

  it('is Admin only', async () => {
    clearRbacDecisionCacheForTest();
    expect((await importCsv(good(), {}, 'read-only')).statusCode).toBe(403);
    expect((await importCsv(good(), {}, 'sales-manager')).statusCode).toBe(403);
    clearRbacDecisionCacheForTest();
  });

  it('rejects the whole file on any error, including cycles and a second root', async () => {
    const cyc = await importCsv([HEADER, 'Root,CEO,,,,,', 'A,VP,a@x.test,b@x.test,,,', 'B,VP,b@x.test,a@x.test,,,'].join('\n'));
    expect(cyc.statusCode).toBe(422);
    expect(cyc.json().errors.map((e: { message: string }) => e.message)).toContain('This reporting line loops back on itself');
    const twoRoots = await importCsv([HEADER, 'One,CEO,,,,,', 'Two,President,,,,,'].join('\n'));
    expect(twoRoots.statusCode).toBe(422);
    expect(twoRoots.json().errors[0]).toMatchObject({ line: 3 });
    const unknown = await importCsv([HEADER, 'Root,CEO,,,,,', 'Lost,VP,,,Nobody,,'].join('\n'));
    expect(unknown.json().errors[0]).toMatchObject({ line: 3, message: 'Manager Nobody is not in the file or on the chart' });
    const badOwner = await importCsv([HEADER, 'Root,CEO,,,,ghost@nowhere.test,'].join('\n'));
    expect(badOwner.statusCode).toBe(422);
    expect(await liveCount()).toBe(0);
  });

  it('dry run reports counts and writes nothing', async () => {
    const res = await importCsv(good(), { dryRun: true });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ dryRun: true, created: 3, updated: 0, errors: [], chartVersion: null });
    expect(await liveCount()).toBe(0);
  });

  it('imports a tree rooted at the CEO, linking contacts by email', async () => {
    const res = await importCsv(`${good()}\n`.replace(HEADER, `${HEADER},nickname`).replace(/\n(?!$)/g, ',\n').replace(/,\n$/, '\n'));
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ created: 3, updated: 0, chartVersion: 2 });
    expect(res.json().warnings[0].message).toMatch(/Ignored unknown columns: nickname/);
    const t = (await call('GET', `/companies/${c.acme}/org-chart`)).json();
    const [ceo, cfo, it2] = t.nodes;
    expect(ceo).toMatchObject({ contactId: p.ceo, parentId: null, placement: 'root', source: 'csv', seniority: 'c_level' });
    expect(cfo).toMatchObject({ contactId: p.cfo, parentId: ceo.id, relationshipStrength: 4, owner: { id: adminId } });
    expect(it2).toMatchObject({ name: 'Dupont, Jean', kind: 'placeholder', parentId: cfo.id });
    expect(cfo.provenance.title.source).toBe('csv');
  });

  it('updates on re-import, attaches new managerless rows under the root, and checks chartVersion', async () => {
    expect((await importCsv(good(), { chartVersion: 1 })).statusCode).toBe(409);
    const res = await importCsv(`${good().replace('Marie Curie,CFO', 'Marie Curie,Group CFO')}\nNew Person,Advisor,,,,,`, { chartVersion: 2 });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ created: 1, updated: 3, chartVersion: 3 });
    const t = (await call('GET', `/companies/${c.acme}/org-chart`)).json();
    expect(t.nodes.find((n: { contactId: string }) => n.contactId === p.cfo).title).toBe('Group CFO');
    expect(t.nodes.find((n: { name: string }) => n.name === 'New Person')).toMatchObject({ parentId: t.chart.rootNodeId, placement: 'inferred' });
    expect(t.chart.nodeCount).toBe(4);
    const audit = await prisma.auditLog.count({ where: { orgId: orgA.orgId, action: 'orgchart.import' } });
    expect(audit).toBe(2);
  });
});

describe('photos', () => {
  let nodeId = '';
  let otherId = '';
  beforeAll(async () => {
    const nodes = await prisma.orgChartNode.findMany({ where: { orgId: orgA.orgId, deletedAt: null }, orderBy: { createdAt: 'asc' }, take: 10 });
    nodeId = nodes.find((n) => n.contactId === p.cfo)!.id;
    otherId = nodes.find((n) => n.contactId === p.ceo)!.id;
  });
  const version = async () => (await prisma.orgChartNode.findUniqueOrThrow({ where: { id: nodeId } })).version;
  async function presign(id = nodeId, bytes = PNG.length) {
    const res = await call('POST', `/org-chart/nodes/${id}/photo/upload-url`, { payload: { contentType: 'image/png', bytes } });
    expect(res.statusCode, res.body).toBe(200);
    return res.json().storageKey as string;
  }

  it('detects real image types only', () => {
    expect(detectPhotoType(PNG)).toBe('image/png');
    expect(detectPhotoType(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]))).toBe('image/jpeg');
    expect(detectPhotoType(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 ')]))).toBe('image/webp');
    expect(detectPhotoType(SVG)).toBeNull();
  });

  it('caps size and type at presign and is Admin only', async () => {
    expect((await call('POST', `/org-chart/nodes/${nodeId}/photo/upload-url`, { payload: { contentType: 'image/png', bytes: 3 * 1024 * 1024 } })).statusCode).toBe(400);
    expect((await call('POST', `/org-chart/nodes/${nodeId}/photo/upload-url`, { payload: { contentType: 'image/svg+xml', bytes: 10 } })).statusCode).toBe(400);
    clearRbacDecisionCacheForTest();
    expect((await call('POST', `/org-chart/nodes/${nodeId}/photo/upload-url`, { role: 'read-only', payload: { contentType: 'image/png', bytes: 10 } })).statusCode).toBe(403);
    clearRbacDecisionCacheForTest();
  });

  it('rejects disguised files and keys issued for another node, deleting the object', async () => {
    const key = await presign();
    storage.put(key, SVG, 'image/png');
    const res = await call('POST', `/org-chart/nodes/${nodeId}/photo`, { payload: { storageKey: key, contentType: 'image/png', bytes: SVG.length, version: await version() } });
    expect(res.statusCode).toBe(400);
    expect(storage.deleted).toContain(key);
    const otherKey = await presign(otherId);
    storage.put(otherKey, PNG, 'image/png');
    expect((await call('POST', `/org-chart/nodes/${nodeId}/photo`, { payload: { storageKey: otherKey, contentType: 'image/png', bytes: PNG.length, version: await version() } })).statusCode).toBe(403);
  });

  it('stores a verified photo, serves it from the API and checks the node version', async () => {
    const key = await presign();
    storage.put(key, PNG, 'image/png');
    const v = await version();
    const res = await call('POST', `/org-chart/nodes/${nodeId}/photo`, { payload: { storageKey: key, contentType: 'image/png', bytes: PNG.length, version: v } });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().node).toMatchObject({ photoUrl: `/api/v1/org-chart/nodes/${nodeId}/photo`, version: v + 1 });
    const get = await call('GET', `/org-chart/nodes/${nodeId}/photo`);
    expect(get.statusCode).toBe(302);
    expect(get.headers.location).toContain(key);

    const key2 = await presign();
    storage.put(key2, PNG, 'image/png');
    const stale = await call('POST', `/org-chart/nodes/${nodeId}/photo`, { payload: { storageKey: key2, contentType: 'image/png', bytes: PNG.length, version: v } });
    expect(stale.statusCode).toBe(409);
    expect(storage.deleted).toContain(key2);

    const local = makeFakeStorage('local');
    local.put(key, PNG, 'image/png');
    __setStorageForTest(local);
    const streamed = await call('GET', `/org-chart/nodes/${nodeId}/photo`);
    expect(streamed.statusCode).toBe(200);
    expect(streamed.headers['content-type']).toBe('image/png');
    expect(streamed.headers['x-content-type-options']).toBe('nosniff');
    expect(streamed.rawPayload.equals(PNG)).toBe(true);
    expect(await prisma.auditLog.count({ where: { orgId: orgA.orgId, action: 'orgchart.node.photo' } })).toBe(1);
  });
});
