import { describe, expect, it } from 'vitest';

import { coverageFor, coverageFromMeetings, covFromPerson, strengthOf } from './coverage';
import { exportCsv } from './csv';
import { layoutTree, NODE_H } from './layout';
import { mergePeople, sampleChart, seniorityFromTitle } from './sample';
import * as T from './tree';
import type { OrgNode, PersonCoverage } from './types';

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

describe('csv export', () => {
  it('writes the API import columns with managers by name, quoting commas', () => {
    const out = exportCsv([n('a', null, { name: 'Ann, CEO', seniority: 'c_level' }), n('b', 'a', { name: 'Bob', title: 'VP Data', relationshipStrength: 4 }), n('r', 'a', { name: 'Restricted', redacted: true })]);
    const lines = out.trim().split('\n');
    expect(lines[0]).toBe('name,title,email,manager_name,seniority,function,region,photo_url,relationship_strength');
    expect(lines[1]).toBe('"Ann, CEO",,,,c_level,,,,');
    expect(lines[2]).toBe('Bob,VP Data,,"Ann, CEO",unknown,,,,4');
    expect(lines).toHaveLength(3); // redacted people are not exported
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
    expect(strengthOf(covFromPerson(coverageFor(cov, { contactId: null, name: 'Michael Johnson' })), now)).toBe('strong');
    expect(strengthOf(undefined, now)).toBe('none');
    const once = { owners: [], challenges: [], meetings: [{ id: 'x', title: '', heldAt: '2025-01-01T00:00:00Z' }], lastMetAt: '2025-01-01T00:00:00Z' } as PersonCoverage;
    expect(strengthOf(covFromPerson(once), now)).toBe('weak');
    expect(strengthOf({ ...covFromPerson(once)!, manual: 5 }, now)).toBe('strong'); // admin-set wins
    expect(strengthOf({ met: true, count: 3, lastMetAt: '2026-10-20T00:00:00Z', meetings: [], challenges: [], owners: [], manual: null }, now)).toBe('strong'); // API counts only
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
