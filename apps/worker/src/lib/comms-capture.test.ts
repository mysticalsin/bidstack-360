import { describe, expect, it, vi } from 'vitest';

import {
  externalParticipants,
  googleMeetingHints,
  graphMeetingHints,
  resolveCaptureTarget,
  type CaptureDb,
} from './comms-capture.js';

const orgId = '00000000-0000-4000-8000-0000000000a1';

function fakeDb(opts: {
  contacts?: Array<{ id: string; email: string; companyId: string | null }>;
  companies?: Array<{ id: string; domain: string }>;
  openOpps?: Record<string, string[]>;
}): CaptureDb & { calls: Record<string, number> } {
  const calls = { contact: 0, company: 0, opportunity: 0 };
  return {
    calls,
    contact: {
      findMany: vi.fn(async (args: { where: { email: { in: string[] } } }) => {
        calls.contact++;
        const wanted = args.where.email.in.map((e) => e.toLowerCase());
        return (opts.contacts ?? []).filter((c) => wanted.includes(c.email.toLowerCase()));
      }),
    },
    company: {
      findFirst: vi.fn(async (args: { where: { OR: Array<{ domain?: { in: string[] } }> } }) => {
        calls.company++;
        const domains = args.where.OR.flatMap((o) => o.domain?.in ?? []);
        return (opts.companies ?? []).find((c) => domains.includes(c.domain)) ?? null;
      }),
    },
    opportunity: {
      findMany: vi.fn(async (args: { where: { companyId: string } }) => {
        calls.opportunity++;
        return (opts.openOpps?.[args.where.companyId] ?? []).map((id) => ({ id }));
      }),
    },
  } as unknown as CaptureDb & { calls: Record<string, number> };
}

describe('externalParticipants', () => {
  it('drops the mailbox owner, colleagues on the same domain, blanks and duplicates', () => {
    expect(
      externalParticipants('tony@amaris.com', [
        'Tony@Amaris.com',
        'colleague@amaris.com',
        'buyer@acme.com',
        'BUYER@acme.com',
        '',
        'not-an-email',
      ]),
    ).toEqual(['buyer@acme.com']);
  });
});

describe('resolveCaptureTarget', () => {
  it('files on the contact, its account and the single open opportunity', async () => {
    const db = fakeDb({
      contacts: [{ id: 'contact-1', email: 'buyer@acme.com', companyId: 'company-1' }],
      openOpps: { 'company-1': ['opp-1'] },
    });
    const target = await resolveCaptureTarget(
      { orgId, ownerEmail: 'tony@amaris.com', participants: ['tony@amaris.com', 'Buyer@Acme.com'] },
      db,
    );
    expect(target).toEqual({
      entityType: 'contact',
      entityId: 'contact-1',
      contactId: 'contact-1',
      companyId: 'company-1',
      opportunityId: 'opp-1',
    });
    expect(db.calls.contact).toBe(1);
  });

  it('falls back to the account by domain when no contact matches', async () => {
    const db = fakeDb({ companies: [{ id: 'company-2', domain: 'acme.com' }] });
    const target = await resolveCaptureTarget(
      { orgId, ownerEmail: 'tony@amaris.com', participants: ['new.person@mail.acme.com'] },
      db,
    );
    expect(target).toEqual({
      entityType: 'company',
      entityId: 'company-2',
      contactId: null,
      companyId: 'company-2',
      opportunityId: null,
    });
  });

  it('leaves the opportunity empty when the account has several open bids', async () => {
    const db = fakeDb({
      companies: [{ id: 'company-3', domain: 'acme.com' }],
      openOpps: { 'company-3': ['opp-a', 'opp-b'] },
    });
    const target = await resolveCaptureTarget(
      { orgId, ownerEmail: null, participants: ['x@acme.com'] },
      db,
    );
    expect(target?.opportunityId).toBeNull();
  });

  it('never matches free mail domains to an account', async () => {
    const db = fakeDb({ companies: [{ id: 'company-4', domain: 'gmail.com' }] });
    const target = await resolveCaptureTarget(
      { orgId, ownerEmail: 'tony@amaris.com', participants: ['someone@gmail.com'] },
      db,
    );
    expect(target).toBeNull();
    expect(db.calls.company).toBe(0);
  });

  it('returns null without querying when only colleagues took part', async () => {
    const db = fakeDb({});
    const target = await resolveCaptureTarget(
      { orgId, ownerEmail: 'tony@amaris.com', participants: ['a@amaris.com', 'b@amaris.com'] },
      db,
    );
    expect(target).toBeNull();
    expect(db.calls.contact).toBe(0);
  });
});

describe('meeting hints', () => {
  it('marks Graph meetings with a Teams join link as Teams, others as in person or other', () => {
    expect(graphMeetingHints({ isOnlineMeeting: true, onlineMeetingProvider: 'teamsForBusiness' }).channel).toBe('teams');
    expect(graphMeetingHints({ onlineMeeting: { joinUrl: 'https://teams.microsoft.com/l/meetup-join/x' } }).channel).toBe(
      'teams',
    );
    expect(graphMeetingHints({ isOnlineMeeting: false }).channel).toBe('in_person_or_other');
    expect(graphMeetingHints({ onlineMeetingUrl: 'https://teams.evil.example/l' }).channel).toBe('in_person_or_other');
  });

  it('reads Graph sensitivity and the owner response', () => {
    expect(graphMeetingHints({ sensitivity: 'private' }).isPrivate).toBe(true);
    expect(graphMeetingHints({ sensitivity: 'confidential' }).isPrivate).toBe(true);
    expect(graphMeetingHints({ sensitivity: 'normal' }).isPrivate).toBe(false);
    expect(graphMeetingHints({ responseStatus: { response: 'declined' } }).ownerDeclined).toBe(true);
    expect(graphMeetingHints({ responseStatus: { response: 'accepted' } }).ownerDeclined).toBe(false);
  });

  it('reads Google visibility, Meet and Teams links, and the self response', () => {
    expect(googleMeetingHints({ hangoutLink: 'https://meet.google.com/abc' }).channel).toBe('google_meet');
    expect(
      googleMeetingHints({ conferenceData: { entryPoints: [{ uri: 'https://teams.microsoft.com/l/meetup-join/y' }] } })
        .channel,
    ).toBe('teams');
    expect(googleMeetingHints({ visibility: 'private' }).isPrivate).toBe(true);
    expect(googleMeetingHints({ visibility: 'default' }).isPrivate).toBe(false);
    expect(
      googleMeetingHints({ attendees: [{ responseStatus: 'accepted' }, { self: true, responseStatus: 'declined' }] })
        .ownerDeclined,
    ).toBe(true);
  });
});
