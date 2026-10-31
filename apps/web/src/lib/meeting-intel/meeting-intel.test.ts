import { describe, expect, it } from 'vitest';

import type { AccountWatchdog } from '@/hooks/useAccountWatchdog';

import { agoLabel, meetingQueryString, parseAttendees, type MeetingIntelDetail } from './client';
import { collectPeople } from './people';
import { mergeMeetingSignals } from './watchdog';

const att = (o: Partial<MeetingIntelDetail['attendees'][number]>) => ({
  id: 'a', name: 'X', email: null, title: null, seniority: 'vp', region: 'GB', businessUnit: null, isInternal: false, contactId: null, reportsToContactId: null, ...o,
}) as MeetingIntelDetail['attendees'][number];
const det = (id: string, heldAt: string, attendees: MeetingIntelDetail['attendees']) =>
  ({ id, heldAt, title: `M ${id}`, companyId: 'c', companyName: 'C', attendees }) as unknown as MeetingIntelDetail;

describe('meeting intel helpers', () => {
  it('parses one attendee per line as Name, Title, Region, BU', () => {
    expect(parseAttendees('Emma Clarke, VP Technology, GB, Wealth\n\n  Oliver Grant  \n')).toEqual([
      { name: 'Emma Clarke', title: 'VP Technology', region: 'GB', businessUnit: 'Wealth' },
      { name: 'Oliver Grant' },
    ]);
  });
  it('labels ages in days, then months', () => {
    const now = Date.parse('2026-10-31T12:00:00Z');
    expect(agoLabel('2026-10-31T08:00:00Z', now)).toBe('today');
    expect(agoLabel('2026-10-30T10:00:00Z', now)).toBe('yesterday');
    expect(agoLabel('2026-10-21T12:00:00Z', now)).toBe('10 days ago');
    expect(agoLabel('2026-06-01T12:00:00Z', now)).toBe('5 months ago');
  });
  it('builds a query string without empty values', () => {
    expect(meetingQueryString({ groupId: 'g', q: '', seniority: 'vp' })).toMatch(/^\?/);
    expect(meetingQueryString({ groupId: 'g', q: '' })).not.toContain('q=');
  });
  it('collects external people for a cell, deduped, with the latest meeting', () => {
    const people = collectPeople([
      det('m1', '2026-10-01T00:00:00Z', [att({ id: '1', name: 'Emma', contactId: 'k1' }), att({ id: '2', name: 'Us', isInternal: true })]),
      det('m2', '2026-10-20T00:00:00Z', [att({ id: '3', name: 'Emma Clarke', contactId: 'k1' }), att({ id: '4', name: 'Other', region: 'US' })]),
    ], { region: 'GB', seniority: 'vp' });
    expect(people).toHaveLength(1);
    expect(people[0]!.meetingId).toBe('m2');
    expect(people[0]!.meetings).toBe(2);
  });
});

describe('mergeMeetingSignals (watchdog task 5)', () => {
  const base = { companyId: 'c1', monitoring: { enabled: true, identifiers: [], lastCheckedAt: null, lastError: null }, events: [
    { id: 'e1', source: 'sec_edgar', kind: 'X', title: 'old', summary: '', sourceUrl: 'https://x', occurredAt: '2026-10-01T00:00:00Z', implication: 'RISK', implicationRationale: null, severity: 3, status: 'NEW' },
  ], earnings: [], pastProjects: [], history: [] } as AccountWatchdog;
  const item = (id: string, companyId: string) => ({ kind: 'MEETING_CROSS_REGION' as const, externalId: id, companyId, occurredAt: '2026-10-30T00:00:00Z', title: `Flag ${id}`, summary: 's', implication: 'OPPORTUNITY' as const, url: `/meeting-intel/flags/${id}` });
  it('adds only this account’s flags as opportunity signals, newest first', () => {
    const out = mergeMeetingSignals(base, [item('f1', 'c1'), item('f2', 'c2')], 'c1');
    expect(out.events.map((e) => e.id)).toEqual(['mi:f1', 'e1']);
    expect(out.events[0]).toMatchObject({ source: 'meeting_intel', implication: 'OPPORTUNITY', sourceUrl: '/meeting-intel/flags/f1' });
  });
  it('is a no-op with no feed (no access or 404)', () => {
    expect(mergeMeetingSignals(base, undefined, 'c1')).toBe(base);
  });
});
