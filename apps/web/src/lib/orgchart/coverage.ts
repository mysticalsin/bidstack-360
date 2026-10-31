// "Met" coverage and relationship strength, derived from meeting intel
// attendees (real data). Matching: contact id first, else the person's name.
import type { MeetingIntelDetail } from '@bidstack/shared';

import { personKey } from './tree';
import type { NodeCov, OrgNode, PersonCoverage, Strength } from './types';

export function coverageFromMeetings(meetings: MeetingIntelDetail[]): Map<string, PersonCoverage> {
  const out = new Map<string, PersonCoverage>();
  const ownerCount = new Map<string, Map<string, number>>();
  for (const m of meetings) {
    const ours = m.attendees.filter((a) => a.isInternal).map((a) => a.name);
    for (const a of m.attendees) {
      if (a.isInternal) continue;
      const keys = [personKey({ contactId: a.contactId, name: a.name }), personKey({ contactId: null, name: a.name })];
      const key = keys[0]!;
      const cur = out.get(key) ?? {
        key, name: a.name, title: a.title, seniority: a.seniority, region: a.region, contactId: a.contactId,
        reportsToContactId: a.reportsToContactId, meetings: [], challenges: [], owners: [], lastMetAt: null,
      };
      if (!cur.meetings.some((x) => x.id === m.id)) cur.meetings.push({ id: m.id, title: m.title, heldAt: m.heldAt });
      for (const c of m.challenges) if (!cur.challenges.includes(c)) cur.challenges.push(c);
      if (!cur.lastMetAt || m.heldAt > cur.lastMetAt) cur.lastMetAt = m.heldAt;
      const oc = ownerCount.get(key) ?? new Map<string, number>();
      for (const o of ours) oc.set(o, (oc.get(o) ?? 0) + 1);
      ownerCount.set(key, oc);
      out.set(key, cur);
      // Also index by name so a chart node without a contact id still matches.
      if (keys[1] !== key && !out.has(keys[1]!)) out.set(keys[1]!, cur);
    }
  }
  for (const [key, oc] of ownerCount) {
    const p = out.get(key)!;
    p.owners = [...oc.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => n);
    p.meetings.sort((a, b) => b.heldAt.localeCompare(a.heldAt));
  }
  return out;
}

export function coverageFor(cov: Map<string, PersonCoverage>, n: Pick<OrgNode, 'contactId' | 'name'>): PersonCoverage | undefined {
  return cov.get(personKey(n)) ?? cov.get(personKey({ contactId: null, name: n.name }));
}

const DAY = 86_400_000;

/** Coverage from client-side meeting intel (Sample charts, and owner fallback). */
export function covFromPerson(p: PersonCoverage | undefined): NodeCov | undefined {
  if (!p) return undefined;
  return { met: p.meetings.length > 0, count: p.meetings.length, lastMetAt: p.lastMetAt, meetings: p.meetings, challenges: p.challenges, owners: p.owners, manual: null };
}

/**
 * Admin-set strength wins (1-2 weak, 3 medium, 4-5 strong). Otherwise:
 * strong = 3+ meetings in a year, or 2 within 90 days; medium = 2+, or one
 * within 180 days; weak = met once, longer ago.
 */
export function strengthOf(p: NodeCov | undefined, now: number): Strength {
  if (p?.manual) return p.manual >= 4 ? 'strong' : p.manual === 3 ? 'medium' : 'weak';
  if (!p || p.count === 0) return 'none';
  const inYear = p.meetings.length ? p.meetings.filter((m) => now - Date.parse(m.heldAt) <= 365 * DAY).length : p.count;
  const days = p.lastMetAt ? (now - Date.parse(p.lastMetAt)) / DAY : Infinity;
  if (inYear >= 3 || (inYear >= 2 && days <= 90)) return 'strong';
  if (p.count >= 2 || days <= 180) return 'medium';
  return 'weak';
}

export const STRENGTH_LABEL: Record<Strength, string> = { strong: 'Strong', medium: 'Medium', weak: 'Weak', none: 'No relationship yet' };
export const STRENGTH_BARS: Record<Strength, number> = { strong: 3, medium: 2, weak: 1, none: 0 };
