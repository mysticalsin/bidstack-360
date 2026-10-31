import { describe, expect, it } from 'vitest';

import {
  classifySeniority,
  crossRegionTalkingPoints,
  emailDomain,
  MeetingIntelManualCreate,
  meetingDedupeMaterial,
  NormalizedMeeting,
  normalizeMeetingTitle,
} from './meeting-intel.js';

describe('classifySeniority', () => {
  it.each([
    ['Chief Financial Officer', 'c_level'],
    ['CIO', 'c_level'],
    ['Directeur Général', 'c_level'],
    ['Managing Director EMEA', 'c_level'],
    ['VP Procurement', 'vp'],
    ['Head of IT Infrastructure', 'vp'],
    ['Senior Vice President, Operations', 'vp'],
    ['IT Director', 'director'],
    ['Directrice des achats', 'director'],
    ['Project Manager', 'manager'],
    ['Team Lead Data', 'manager'],
    ['Data Engineer', 'ic'],
    ['Acheteur', 'ic'],
    ['', 'unknown'],
    [null, 'unknown'],
    ['Ninja', 'unknown'],
  ])('%s -> %s', (title, want) => {
    expect(classifySeniority(title)).toBe(want);
  });
});

describe('dedupe material', () => {
  const base = { orgId: 'o', companyId: 'c', heldAt: new Date('2026-10-30T09:00:00Z') };
  it('ignores reply prefixes, accents, case and time of day', () => {
    expect(normalizeMeetingTitle('RE: Revue Stratégique  Q4!')).toBe('revue strategique q4');
    const a = meetingDedupeMaterial({ ...base, title: 'Revue stratégique Q4', attendeeEmails: [] });
    const b = meetingDedupeMaterial({
      ...base,
      heldAt: new Date('2026-10-30T17:30:00Z'),
      title: 'Fwd: revue strategique q4',
      attendeeEmails: [],
    });
    expect(a.byTitle).toBe(b.byTitle);
  });
  it('attendee key needs two emails and is order-insensitive', () => {
    expect(meetingDedupeMaterial({ ...base, title: 'x', attendeeEmails: ['a@x.com'] }).byAttendees).toBeNull();
    const a = meetingDedupeMaterial({ ...base, title: 'x', attendeeEmails: ['B@x.com', 'a@x.com'] });
    const b = meetingDedupeMaterial({ ...base, title: 'y', attendeeEmails: ['a@x.com', 'b@x.com', 'a@x.com'] });
    expect(a.byAttendees).toBe(b.byAttendees);
  });
});

describe('misc', () => {
  it('emailDomain', () => {
    expect(emailDomain('Jane@WWW.Acme.fr')).toBe('acme.fr');
    expect(emailDomain('nope')).toBeNull();
  });
  it('talking points carry no em dash and redact the region when restricted', () => {
    const pts = crossRegionTalkingPoints({
      parentName: 'Acme Group',
      meetingRegion: 'FR',
      ownedRegion: 'DE',
      topSeniority: 'c_level',
      challenges: ['legacy ERP \u2014 slow close'],
      opportunities: ['data platform'],
      restricted: true,
    });
    expect(pts[0]).toContain('C-level meeting took place in another region');
    expect(pts.join(' ')).not.toMatch(/\u2014/);
    expect(pts.join(' ')).not.toContain('FR');
    expect(pts).toHaveLength(3);
  });
  it('schemas: defaults and manual entry cannot carry a transcript', () => {
    const m = NormalizedMeeting.parse({ externalId: 'x', title: 't', heldAt: '2026-10-30T09:00:00Z' });
    expect(m.attendees).toEqual([]);
    expect(m.challenges).toEqual([]);
    const manual = MeetingIntelManualCreate.parse({
      companyId: '6f1c1d3e-5b1a-4c3e-9a55-0d6f3c2b1a00',
      title: 't',
      heldAt: '2026-10-30T09:00:00Z',
      transcript: 'secret',
    } as never);
    expect('transcript' in manual).toBe(false);
  });
});
