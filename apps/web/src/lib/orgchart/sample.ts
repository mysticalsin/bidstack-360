// Placement rules shared by the Sample structure and "Auto-fill": people we
// know (contacts, meeting attendees) slot in under the best-matching manager.
import type { SeniorityLevel } from '@bidstack/shared';

import { newId, personKey } from './tree';
import type { OrgChart, OrgNode, PersonCoverage } from './types';

const RANK: Record<SeniorityLevel, number> = { c_level: 0, vp: 1, director: 2, manager: 3, ic: 4, unknown: 5 };

type Branch = 'tech' | 'finance' | 'ops' | 'risk' | 'people' | 'commercial' | null;
const BRANCH: Array<[Branch, RegExp]> = [
  ['tech', /information|technology|tech|infrastructure|security|engineering|data|digital|cloud|it\b|product|architect/i],
  ['finance', /financ|cfo|treasur|account|tax|controller/i],
  ['risk', /risk|compliance|legal|protection|privacy|audit/i],
  ['people', /people|hr\b|human|talent/i],
  ['commercial', /sales|marketing|commercial|revenue|client|customer|distribution/i],
  ['ops', /operat|coo\b/i],
];
export const branchOf = (title: string | null): Branch => (title ? (BRANCH.find(([, r]) => r.test(title))?.[0] ?? null) : null);

/** The best manager for a person: same branch, more senior, closest rank; else the root. */
export function bestParent(nodes: OrgNode[], rootId: string | null, p: { title: string | null; seniority: SeniorityLevel; region: string | null }): string | null {
  const b = branchOf(p.title);
  const r = RANK[p.seniority];
  const cands = nodes
    .filter((n) => RANK[n.seniority] < r && (b ? branchOf(n.title) === b : false))
    .sort((x, y) => RANK[y.seniority] - RANK[x.seniority] || Number(y.region === p.region) - Number(x.region === p.region));
  return cands[0]?.id ?? rootId;
}

const SAMPLE: Array<[string, string, SeniorityLevel, string | null, number | null]> = [
  // name, title, seniority, region, parent index
  ['Alex Morgan', 'Chief Executive Officer', 'c_level', 'CA', null],
  ['Priya Raman', 'Chief Financial Officer', 'c_level', 'CA', 0],
  ['Daniel Okafor', 'Chief Operating Officer', 'c_level', 'CA', 0],
  ['Chief Information Officer', 'Chief Information Officer', 'c_level', 'CA', 0],
  ['Laura Chen', 'Chief Risk Officer', 'c_level', 'CA', 0],
  ['Marc Dubois', 'Chief Commercial Officer', 'c_level', 'CA', 0],
  ['Hannah Weiss', 'VP Data & Analytics', 'vp', 'CA', 3],
  ['Samuel Reyes', 'Head of Group Treasury', 'director', 'CA', 1],
  ['Ines Duarte', 'VP Operations, Europe', 'vp', 'GB', 2],
  ['Kenji Watanabe', 'Head of Distribution, US', 'director', 'US', 5],
];

/**
 * A Sample structure for an account nobody has charted yet: a typical
 * executive backbone, with every person we have actually met placed in it.
 * Met people keep their real names and titles; the rest are labelled Sample.
 */
export function sampleChart(companyId: string, people: PersonCoverage[]): OrgChart {
  let nodes: OrgNode[] = [];
  const ids: string[] = [];
  for (const [name, title, seniority, region, parent] of SAMPLE) {
    const id = `s-${ids.length}`;
    ids.push(id);
    nodes.push({ id, parentId: parent === null ? null : ids[parent]!, name, title, photoUrl: null, seniority, region, contactId: null, email: null, ownerName: null, source: 'sample' });
  }
  const rootId = ids[0]!;
  const result = mergePeople({ companyId, rootId, version: 0, updatedAt: null, updatedBy: null, sample: true, nodes }, people, 'meetings');
  nodes = result.chart.nodes;
  // A sample placeholder for a role we have now met for real takes the real name.
  return { ...result.chart, nodes };
}

/** Add people not yet on the chart (by contact id or name). Returns how many were added. */
export function mergePeople(chart: OrgChart, people: Array<Pick<PersonCoverage, 'name' | 'title' | 'seniority' | 'region' | 'contactId' | 'reportsToContactId'> & { email?: string | null }>, source: OrgNode['source']): { chart: OrgChart; added: number } {
  let nodes = [...chart.nodes];
  const have = new Set(nodes.map(personKey));
  const byContact = new Map(nodes.filter((n) => n.contactId).map((n) => [n.contactId!, n.id]));
  const ordered = [...people].sort((a, b) => RANK[a.seniority] - RANK[b.seniority]);
  let added = 0;
  for (const p of ordered) {
    const key = personKey(p);
    if (have.has(key) || have.has(personKey({ contactId: null, name: p.name }))) continue;
    // A placeholder with exactly this title (e.g. the sample CIO) becomes this person.
    const slot = nodes.find((n) => n.source === 'sample' && n.name === n.title && p.title && n.title?.toLowerCase() === p.title.toLowerCase());
    if (slot) {
      nodes = nodes.map((n) => (n.id === slot.id ? { ...n, name: p.name, contactId: p.contactId, region: p.region ?? n.region, source } : n));
    } else {
      const parent = (p.reportsToContactId && byContact.get(p.reportsToContactId)) || bestParent(nodes, chart.rootId, p);
      const id = newId();
      nodes.push({ id, parentId: parent, name: p.name, title: p.title, photoUrl: null, seniority: p.seniority, region: p.region, contactId: p.contactId, email: p.email ?? null, ownerName: null, source });
      if (p.contactId) byContact.set(p.contactId, id);
    }
    have.add(key);
    added++;
  }
  return { chart: { ...chart, nodes }, added };
}

/** Best-effort seniority from a job title (contacts carry a role string only). */
export function seniorityFromTitle(title: string | null): SeniorityLevel {
  if (!title) return 'unknown';
  if (/\bchief\b|\bc[a-z]o\b|\bceo\b|president|founder|managing director/i.test(title)) return 'c_level';
  if (/\bvp\b|vice president|\bsvp\b|\bevp\b/i.test(title)) return 'vp';
  if (/director|\bhead of\b/i.test(title)) return 'director';
  if (/manager|lead\b/i.test(title)) return 'manager';
  return 'ic';
}
