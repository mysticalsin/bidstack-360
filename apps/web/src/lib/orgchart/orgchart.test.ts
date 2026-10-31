import { beforeEach, describe, expect, it } from 'vitest';

import { fetchOrgChart, saveOrgChart } from './client';
import { coverageFor, coverageFromMeetings, strengthOf } from './coverage';
import { exportCsv, importCsv } from './csv';
import { layoutTree, NODE_H } from './layout';
import { mergePeople, sampleChart, seniorityFromTitle } from './sample';
import * as T from './tree';
import { OrgChartConflictError, type OrgNode, type PersonCoverage } from './types';

const n = (id: string, parentId: string | null, extra: Partial<OrgNode> = {}): OrgNode => ({
  id, parentId, name: id.toUpperCase(), title: null, photoUrl: null, seniority: 'unknown', region: null,
  contactId: null, email: null, ownerName: null, source: 'manual', ...extra,
});
// a ─ b ─ d
//   └ c
const base = [n('a', null), n('b', 'a'), n('c', 'a'), n('d', 'b')];

describe('tree ops', () => {
  it('blocks re-parenting under a descendant (no cycles)', () => {
    expect(T.canReparent(base, 'a', 'd')).toBe(false);
    expect(T.reparent(base, 'a', 'd')).toBe(base);
    expect(T.reparent(base, 'd', 'c').find((x) => x.id === 'd')!.parentId).toBe('c');
  });
  it('remove moves reports up to the removed manager', () => {
    const r = T.remove(base, 'a', 'b');
    expect(r.nodes.find((x) => x.id === 'd')!.parentId).toBe('a');
    expect(r.rootId).toBe('a');
  });
  it('removing the root promotes its first report', () => {
    const r = T.remove(base, 'a', 'a');
    expect(r.rootId).toBe('b');
    expect(r.nodes.find((x) => x.id === 'c')!.parentId).toBe('b');
  });
  it('setRoot flips the path above the new root', () => {
    const r = T.setRoot(base, 'd');
    const p = Object.fromEntries(r.nodes.map((x) => [x.id, x.parentId]));
    expect(p).toEqual({ d: null, b: 'd', a: 'b', c: 'a' });
  });
  it('collapse hides descendants only', () => {
    expect([...T.hiddenBy(base, new Set(['b']))]).toEqual(['d']);
  });
  it('normalise hangs orphans off the root', () => {
    const r = T.normalise([...base, n('x', 'missing')], 'a');
    expect(r.nodes.find((x) => x.id === 'x')!.parentId).toBe('a');
  });
});

describe('layout', () => {
  it('lays the tree out top-down', () => {
    const pos = layoutTree(base);
    expect(pos.get('b')!.y).toBeGreaterThanOrEqual(pos.get('a')!.y + NODE_H);
    expect(pos.get('d')!.y).toBeGreaterThan(pos.get('b')!.y);
  });
});

describe('csv', () => {
  it('round-trips and resolves managers by name', () => {
    const r = importCsv('name,title,seniority,region,manager\n"Ann, CEO",Chief Executive Officer,c-level,CA,\nBob,VP Data,vp,GB,"Ann, CEO"\nCy,Analyst,ic,,Nobody\n');
    expect(r.nodes).toHaveLength(3);
    const ann = r.nodes.find((x) => x.name === 'Ann, CEO')!;
    expect(r.rootId).toBe(ann.id);
    expect(r.nodes.find((x) => x.name === 'Bob')!.parentId).toBe(ann.id);
    expect(r.nodes.find((x) => x.name === 'Bob')!.seniority).toBe('vp');
    expect(r.errors.some((e) => e.includes('Nobody'))).toBe(true);
    const again = importCsv(exportCsv(r.nodes));
    expect(again.nodes.find((x) => x.name === 'Bob')!.parentId).toBe(again.nodes.find((x) => x.name === 'Ann, CEO')!.id);
  });
  it('rejects a file without a name column', () => {
    expect(importCsv('title\nCEO').errors[0]).toMatch(/name/);
  });
});

const meeting = (id: string, heldAt: string, people: Array<{ name: string; title?: string; internal?: boolean; contactId?: string | null }>, challenges: string[] = []) => ({
  id, title: `Meeting ${id}`, heldAt, challenges,
  attendees: people.map((p) => ({ name: p.name, title: p.title ?? null, isInternal: Boolean(p.internal), contactId: p.contactId ?? null, seniority: 'c_level', region: 'CA', reportsToContactId: null })),
}) as never;

describe('coverage and strength', () => {
  const ms = [
    meeting('m1', '2026-10-01T10:00:00Z', [{ name: 'Michael Johnson', title: 'Chief Information Officer' }, { name: 'Jane Smith', internal: true }], ['Legacy core']),
    meeting('m2', '2026-09-01T10:00:00Z', [{ name: 'Michael Johnson' }, { name: 'Jane Smith', internal: true }, { name: 'Mark T', internal: true }]),
  ];
  const cov = coverageFromMeetings(ms);
  const now = Date.parse('2026-10-31T00:00:00Z');
  it('collects meetings, challenges and the most frequent owner', () => {
    const p = coverageFor(cov, { contactId: null, name: 'michael  johnson' })!;
    expect(p.meetings.map((m) => m.id)).toEqual(['m1', 'm2']);
    expect(p.challenges).toEqual(['Legacy core']);
    expect(p.owners[0]).toBe('Jane Smith');
  });
  it('grades strength from count and recency', () => {
    expect(strengthOf(coverageFor(cov, { contactId: null, name: 'Michael Johnson' }), now)).toBe('strong');
    expect(strengthOf(undefined, now)).toBe('none');
    const once = { meetings: [{ id: 'x', title: '', heldAt: '2025-01-01T00:00:00Z' }], lastMetAt: '2025-01-01T00:00:00Z' } as PersonCoverage;
    expect(strengthOf(once, now)).toBe('weak');
  });
});

describe('sample and merge', () => {
  const people = [
    { key: 'k1', name: 'Michael Johnson', title: 'Chief Information Officer', seniority: 'c_level', region: 'CA', contactId: null, reportsToContactId: null, meetings: [], challenges: [], owners: [], lastMetAt: null },
    { key: 'k2', name: 'Sarah Patel', title: 'IT Security Manager', seniority: 'manager', region: 'CA', contactId: null, reportsToContactId: null, meetings: [], challenges: [], owners: [], lastMetAt: null },
  ] as PersonCoverage[];
  it('places met people into the sample backbone; a matching placeholder takes the real name', () => {
    const c = sampleChart('co', people);
    expect(c.sample).toBe(true);
    const cio = c.nodes.find((x) => x.name === 'Michael Johnson')!;
    expect(cio.title).toBe('Chief Information Officer');
    expect(c.nodes.some((x) => x.name === 'Chief Information Officer')).toBe(false);
    const sarah = c.nodes.find((x) => x.name === 'Sarah Patel')!;
    expect(T.ancestors(c.nodes, sarah.id)).toContain(cio.id);
  });
  it('merge skips people already on the chart', () => {
    const c = sampleChart('co', people);
    expect(mergePeople(c, people, 'contacts').added).toBe(0);
  });
  it('guesses seniority from titles', () => {
    expect(seniorityFromTitle('Chief Risk Officer')).toBe('c_level');
    expect(seniorityFromTitle('Head of Data Protection')).toBe('director');
    expect(seniorityFromTitle('SVP Sales')).toBe('vp');
  });
});

describe('mock client', () => {
  beforeEach(() => localStorage.clear());
  it('saves with a version and reports a conflict when someone saved first', async () => {
    expect(await fetchOrgChart('co')).toBeNull();
    const chart = { companyId: 'co', rootId: 'a', version: 0, updatedAt: null, updatedBy: null, sample: true, nodes: base };
    const v1 = await saveOrgChart(chart, 0, 'Jane');
    expect(v1).toMatchObject({ version: 1, sample: false, updatedBy: 'Jane' });
    await saveOrgChart(v1, 1, 'Mark');
    await expect(saveOrgChart(v1, 1, 'Jane')).rejects.toBeInstanceOf(OrgChartConflictError);
    await saveOrgChart(v1, 0, 'Jane').catch((e: OrgChartConflictError) => expect(e.current).toMatchObject({ version: 2, updatedBy: 'Mark' }));
  });
});
