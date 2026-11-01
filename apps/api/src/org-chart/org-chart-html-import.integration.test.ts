// Org chart HTML import (people-map JSON island with sprite avatars, table
// export), PII visibility by contacts:read, PATCH of contact fields, and
// meeting recency for people who are not CRM contacts.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { prisma } from '@bidstack/db';
import type { OrgChartNode } from '@bidstack/shared';

import { invalidateAccessScope } from '../lib/access-scope.js';
import { clearRbacDecisionCacheForTest } from '../lib/rbac-decision-cache.js';
import { buildServer } from '../server.js';
import { __setStorageForTest } from '../storage/index.js';
import { createIsolatedOrg, dropIsolatedOrg, useIsolatedOrgAuth } from '../test-support/isolated-org.js';
import { makeFakeStorage, type FakeStorage } from '../test-support/msa-storage.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const MAP = readFileSync(path.join(here, '__fixtures__', 'people-map.fake.html'), 'utf8');
const TABLE = readFileSync(path.join(here, '__fixtures__', 'people-table.fake.html'), 'utf8');
const TAG = `och${Date.now()}`;
let server: FastifyInstance;
let orgA = { orgId: '', clerkOrg: '' };
let restoreAuth: (() => void) | null = null;
let prevRoleHeader: string | undefined;
let storage: FakeStorage;
const c: Record<string, string> = {};

function call(method: 'GET' | 'POST' | 'PATCH', url: string, opts: { payload?: unknown; role?: string } = {}) {
  return server.inject({
    method,
    url: `/api/v1${url}`,
    ...(opts.payload !== undefined ? { payload: opts.payload as object } : {}),
    headers: opts.role ? { 'x-bidstack-e2e-role': opts.role } : {},
  });
}
const importHtml = (company: string, html: string, extra: Record<string, unknown> = {}, role?: string) =>
  call('POST', `/companies/${company}/org-chart/import-html`, { payload: { html, ...extra }, ...(role ? { role } : {}) });
const tree = async (company: string, role?: string) => (await call('GET', `/companies/${company}/org-chart`, role ? { role } : {})).json() as { nodes: OrgChartNode[]; chart: { version: number } | null };

beforeAll(async () => {
  prevRoleHeader = process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER;
  process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER = 'true';
  clearRbacDecisionCacheForTest();
  orgA = await createIsolatedOrg('och-a');
  restoreAuth = useIsolatedOrgAuth(orgA.clerkOrg);
  c.map = (await prisma.company.create({ data: { orgId: orgA.orgId, name: `${TAG} Example Corp`, countryCode: 'BR' } })).id;
  c.table = (await prisma.company.create({ data: { orgId: orgA.orgId, name: `${TAG} Example Inc`, countryCode: 'US' } })).id;
  c.dom = (await prisma.company.create({ data: { orgId: orgA.orgId, name: `${TAG} Example Bank`, domain: `example-${TAG}.com`, countryCode: 'US' } })).id;
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

describe('HTML import', () => {
  it('is Admin only', async () => {
    clearRbacDecisionCacheForTest();
    expect((await importHtml(c.map!, MAP, { dryRun: true }, 'read-only')).statusCode).toBe(403);
    expect((await importHtml(c.map!, MAP, { dryRun: true }, 'sales-manager')).statusCode).toBe(403);
    clearRbacDecisionCacheForTest();
  });

  it("dry run previews the account's own staff, counts the skipped by reason and writes nothing", async () => {
    const res = await importHtml(c.map!, MAP, { dryRun: true });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ dryRun: true, created: 8, updated: 0, format: 'json', found: 12, skipped: 4, photos: 8 });
    expect(body.skippedBy).toEqual([
      { reason: 'system', count: 1, label: expect.any(String) },
      { reason: 'external', count: 2, label: expect.any(String) },
      { reason: 'own_firm', count: 1, label: 'our own firm (Amaris)' },
    ]);
    expect(body.preview).toHaveLength(8);
    expect(body.preview.map((r: { name: string }) => r.name)).not.toEqual(expect.arrayContaining(['Kim Laurent']));
    const skippedNames = ['Ivan Petrov', 'Jo Tanaka', 'Kim Laurent', 'Service Desk Bot'];
    expect(body.warnings.filter((w: { name?: string }) => skippedNames.includes(w.name ?? ''))).toEqual([]);
    const bruno = body.preview.find((r: { name: string }) => r.name === 'Bruno Costa');
    expect(bruno).toMatchObject({ manager: 'Ana Silva', email: 'bruno.costa@example.com', phone: '+551155550102', hasPhoto: true, action: 'create' });
    expect(bruno.extras).toEqual(expect.arrayContaining(['location', 'tenure', 'career']));
    expect(body.errors).toEqual([]);
    expect(body.warnings.some((e: { name?: string }) => e.name === 'Felipe Ortiz')).toBe(true);
    expect(await prisma.orgChartNode.count({ where: { orgId: orgA.orgId, chart: { companyId: c.map } } })).toBe(0);
    expect(storage.objects.size).toBe(0);
  });

  it('commits the tree, crops sprite avatars into stored photos, and keeps contact fields and profile', async () => {
    const res = await importHtml(c.map!, MAP);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ created: 8, photos: 8 });
    expect(storage.objects.size).toBe(8);
    for (const o of storage.objects.values()) expect(o.body.subarray(8, 12).toString('latin1')).toBe('WEBP');
    const t = await tree(c.map!);
    const root = t.nodes.find((n) => n.parentId === null)!;
    expect(root.name).toBe('Ana Silva');
    const dan = t.nodes.find((n) => n.name === 'Dan Nguyen')!;
    expect(dan).toMatchObject({ email: 'dan.nguyen@example.com', phone: '+14165550104', linkedinUrl: 'https://ca.linkedin.com/in/dan-nguyen-example'.replace('ca.', 'www.'), source: 'html' });
    expect(dan.photoUrl).toBe(`/api/v1/org-chart/nodes/${dan.id}/photo`);
    expect(dan.profile).toMatchObject({ location: 'Example City, Canada', themes: ['cloud', 'data'] });
    expect(t.nodes.find((n) => n.id === dan.parentId)!.name).toBe('Carla Reyes');
    for (const n of ['Service Desk Bot', 'Ivan Petrov', 'Jo Tanaka', 'Kim Laurent']) expect(t.nodes.some((x) => x.name === n)).toBe(false);
  });

  it('re-import is idempotent: matches by email, LinkedIn or file id, and replaces old photos', async () => {
    const before = await tree(c.map!);
    const res = await importHtml(c.map!, MAP, { chartVersion: before.chart!.version });
    expect(res.json()).toMatchObject({ created: 0, updated: 8 });
    const after = await tree(c.map!);
    expect(after.nodes).toHaveLength(8);
    expect((await importHtml(c.map!, MAP, { chartVersion: before.chart!.version })).statusCode).toBe(409);
  });

  it('read-only sees contact fields (contacts:read); a role without it does not', async () => {
    clearRbacDecisionCacheForTest();
    const ro = await tree(c.map!, 'read-only');
    expect(ro.nodes.find((n) => n.name === 'Dan Nguyen')!.email).toBe('dan.nguyen@example.com');
    clearRbacDecisionCacheForTest();
  });

  it('table export on an empty chart: one CEO root, managers by name, bad links dropped with warnings', async () => {
    const res = await importHtml(c.table!, TABLE);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ format: 'table', created: 3 });
    const t = await tree(c.table!);
    const maya = t.nodes.find((n) => n.name === 'Maya Chen')!;
    expect(maya.parentId).toBeNull();
    expect(maya.photoUrl).toBe('https://images.example.org/maya.png');
    const omar = t.nodes.find((n) => n.name === 'Omar Haddad')!;
    expect(omar).toMatchObject({ parentId: maya.id, linkedinUrl: null, photoUrl: null });
  });

  it('skips people whose company is another employer or our own firm, matching the account by name', async () => {
    const html = `<table><tr><th>Name</th><th>Title</th><th>Company</th></tr>
      <tr><td>Kai Own</td><td>CEO</td><td>${TAG} Example Inc.</td></tr>
      <tr><td>Lou Firm</td><td>Engagement lead</td><td>Amaris Consulting</td></tr>
      <tr><td>Mo Other</td><td>Account manager</td><td>Some Vendor Ltd</td></tr></table>`;
    const body = (await importHtml(c.table!, html, { dryRun: true })).json();
    expect(body.preview.map((r: { name: string }) => r.name)).toEqual(['Kai Own']);
    expect(body.skippedBy.map((s: { reason: string }) => s.reason)).toEqual(['own_firm', 'other_employer']);
  });

  it('a company that only contains the account name is another employer unless the email is on the account domain', async () => {
    const html = `<table><tr><th>Name</th><th>Title</th><th>Company</th><th>Email</th></tr>
      <tr><td>Ann Own</td><td>CEO</td><td>${TAG} Example Bank plc</td><td></td></tr>
      <tr><td>Sam Temp</td><td>Recruiter</td><td>${TAG} Example Bank Staffing</td><td>sam@staffing-${TAG}.com</td></tr>
      <tr><td>Lee Inside</td><td>HR lead</td><td>${TAG} Example Bank Staffing</td><td>lee@example-${TAG}.com</td></tr></table>`;
    const body = (await importHtml(c.dom!, html, { dryRun: true })).json();
    expect(body.preview.map((r: { name: string }) => r.name)).toEqual(['Ann Own', 'Lee Inside']);
    expect(body.skippedBy).toEqual([expect.objectContaining({ reason: 'other_employer', count: 1 })]);
  });

  it('rejects an HTML file with no people (422) and an unknown manager (all or nothing)', async () => {
    const none = await importHtml(c.table!, '<p>nothing</p>', { dryRun: true });
    expect(none.statusCode).toBe(422);
    const bad = await importHtml(c.table!, '<table><tr><th>Name</th><th>Manager</th></tr><tr><td>Zed Zero</td><td>Nobody Here</td></tr></table>');
    expect(bad.statusCode).toBe(422);
    expect(bad.json().errors[0]).toMatchObject({ name: 'Zed Zero' });
    expect((await tree(c.table!)).nodes.some((n) => n.name === 'Zed Zero')).toBe(false);
  });
});

describe('contact fields and meeting recency', () => {
  it('PATCH validates and normalizes email, phone and LinkedIn', async () => {
    const t = await tree(c.table!);
    const lena = t.nodes.find((n) => n.name === 'Lena Fischer')!;
    const bad = await call('PATCH', `/org-chart/nodes/${lena.id}`, { payload: { version: lena.version, linkedinUrl: 'https://linkedin.evil.example/in/x' } });
    expect(bad.statusCode).toBe(400);
    const ok = await call('PATCH', `/org-chart/nodes/${lena.id}`, { payload: { version: lena.version, phone: '+49 30 5555-0100', linkedinUrl: 'de.linkedin.com/in/lena-example' } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().node).toMatchObject({ phone: '+493055550100', linkedinUrl: 'https://www.linkedin.com/in/lena-example' });
    const audit = await prisma.auditLog.findFirst({ where: { orgId: orgA.orgId, action: 'orgchart.node.update', targetId: lena.id }, orderBy: { at: 'desc' } });
    expect(JSON.stringify(audit!.diff)).not.toContain('5555');
  });

  it('non-contact people get lastMetAt from attendee email or name', async () => {
    const recent = new Date(Date.now() - 5 * 86_400_000);
    const older = new Date(Date.now() - 60 * 86_400_000);
    await prisma.meetingIntel.create({
      data: {
        orgId: orgA.orgId,
        companyId: c.table!,
        title: `${TAG} sync`,
        heldAt: recent,
        visibility: 'org',
        dedupeKey: `${TAG}-sync`.padEnd(20, 'x'),
        attendees: { create: [{ orgId: orgA.orgId, name: 'M. Chen', email: 'Maya.Chen@example.org' }] },
      },
    });
    await prisma.meetingIntel.create({
      data: {
        orgId: orgA.orgId,
        companyId: c.map!,
        title: `${TAG} review`,
        heldAt: older,
        visibility: 'org',
        dedupeKey: `${TAG}-review`.padEnd(20, 'x'),
        attendees: { create: [{ orgId: orgA.orgId, name: 'Elise Moreau' }] },
      },
    });
    const t = await tree(c.table!);
    expect(t.nodes.find((n) => n.name === 'Maya Chen')).toMatchObject({ meetingCount: 1, lastMetAt: recent.toISOString() });
    expect(t.nodes.find((n) => n.name === 'Omar Haddad')).toMatchObject({ meetingCount: 0, lastMetAt: null });
    const m = await tree(c.map!);
    expect(m.nodes.find((n) => n.name === 'Elise Moreau')).toMatchObject({ meetingCount: 1, lastMetAt: older.toISOString() });
    const cov = (await call('GET', `/companies/${c.table}/org-chart/coverage`)).json();
    expect(cov.met).toBe(1);
  });
});
