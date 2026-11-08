import { describe, expect, it, vi } from 'vitest';

import { commitTokenDeltaState } from './activity-bridge-commit.js';
import {
  ACTIVITY_BRIDGE_RETRY_LIMIT,
  externalParticipants,
  googleMeetingHints,
  graphMeetingHints,
  mergeBridgeDeltaState,
  noteActivityBridgeFailures,
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

describe('activity bridge retry bound', () => {
  it('holds one failing id until the bound, then quarantines it without the subject', () => {
    const state: Record<string, unknown> = {};
    const now = '2026-11-08T03:00:00.000Z';
    expect(noteActivityBridgeFailures(state, 'page-1', ['evt-poison'], now).hold).toBe(true);
    expect(noteActivityBridgeFailures(state, 'page-1', ['evt-poison'], now).hold).toBe(true);
    const done = noteActivityBridgeFailures(state, 'page-1', ['evt-poison'], now);
    expect(done.hold).toBe(false);
    expect(done.quarantined).toEqual(['evt-poison']);
    expect(state.activityBridgeRetry).toBeUndefined();
    expect(state.activityBridgeQuarantine).toEqual([
      { id: 'evt-poison', attempts: ACTIVITY_BRIDGE_RETRY_LIMIT, at: now },
    ]);
    expect(JSON.stringify(state.activityBridgeQuarantine)).not.toContain('subject');
  });

  it('keeps holding while a different id on the same page is still inside the bound', () => {
    const state: Record<string, unknown> = {};
    noteActivityBridgeFailures(state, 'page-1', ['poison']);
    noteActivityBridgeFailures(state, 'page-1', ['poison']);
    const mixed = noteActivityBridgeFailures(state, 'page-1', ['poison', 'fresh']);
    expect(mixed.quarantined).toEqual(['poison']);
    expect(mixed.hold).toBe(true);
    const pages = state.activityBridgeRetryByPage as Record<string, Record<string, number>>;
    expect(pages['page-1']?.poison).toBe(ACTIVITY_BRIDGE_RETRY_LIMIT);
    expect(pages['page-1']?.fresh).toBe(1);
  });

  it('keeps Inbox and Sent counts when the folders interleave', () => {
    const state: Record<string, unknown> = {};
    expect(noteActivityBridgeFailures(state, 'inbox', ['poison']).hold).toBe(true);
    expect(noteActivityBridgeFailures(state, 'sent', ['other']).hold).toBe(true);
    expect(noteActivityBridgeFailures(state, 'inbox', ['poison']).hold).toBe(true);
    const third = noteActivityBridgeFailures(state, 'inbox', ['poison']);
    expect(third.hold).toBe(false);
    expect(third.quarantined).toEqual(['poison']);
    const pages = state.activityBridgeRetryByPage as Record<string, Record<string, number>>;
    expect(pages.inbox?.poison).toBe(ACTIVITY_BRIDGE_RETRY_LIMIT);
    expect(pages.sent?.other).toBe(1);
    expect(noteActivityBridgeFailures(state, 'sent', []).hold).toBe(false);
    expect((state.activityBridgeRetryByPage as Record<string, Record<string, number>>).inbox?.poison).toBe(
      ACTIVITY_BRIDGE_RETRY_LIMIT,
    );
  });

  it('applies concurrent pulls in order so neither folder loses an increment', () => {
    const now = '2026-11-08T03:00:00.000Z';
    const start = { calendarDeltaLink: 'cal-keep' };
    const afterInbox = mergeBridgeDeltaState(start, { ...start, mailNextLink: 'inbox-page' }, [
      { page: 'inbox', failedIds: ['poison'] },
    ], now);
    const staleSent = { calendarDeltaLink: 'cal-keep', mailSentNextLink: 'sent-page' };
    const afterSent = mergeBridgeDeltaState(afterInbox, staleSent, [{ page: 'sent', failedIds: ['other'] }], now);
    const pages = afterSent.activityBridgeRetryByPage as Record<string, Record<string, number>>;
    expect(pages.inbox?.poison).toBe(1);
    expect(pages.sent?.other).toBe(1);
    expect(afterSent.calendarDeltaLink).toBe('cal-keep');
    expect(afterSent.mailSentNextLink).toBe('sent-page');
    const again = mergeBridgeDeltaState(afterSent, staleSent, [{ page: 'inbox', failedIds: ['poison'] }], now);
    expect((again.activityBridgeRetryByPage as Record<string, Record<string, number>>).inbox?.poison).toBe(2);
  });

  it('drops the oldest page and quarantines its open ids once the page cap is reached', () => {
    const state: Record<string, unknown> = {};
    const now = '2026-11-08T03:00:00.000Z';
    for (let i = 0; i < 9; i++) noteActivityBridgeFailures(state, `page-${i}`, [`id-${i}`], now);
    const pages = state.activityBridgeRetryByPage as Record<string, Record<string, number>>;
    expect(Object.keys(pages)).toHaveLength(8);
    expect(pages['page-0']).toBeUndefined();
    expect(pages['page-8']?.['id-8']).toBe(1);
    expect(state.activityBridgeQuarantine).toEqual([{ id: 'id-0', attempts: 1, at: now }]);
  });

  it('quarantines ids past the per-page cap instead of growing the map', () => {
    const state: Record<string, unknown> = {};
    const ids = Array.from({ length: 33 }, (_, i) => `id-${i}`);
    noteActivityBridgeFailures(state, 'page-1', ids, '2026-11-08T03:00:00.000Z');
    const counts = (state.activityBridgeRetryByPage as Record<string, Record<string, number>>)['page-1'] ?? {};
    expect(Object.keys(counts)).toHaveLength(32);
    const quarantined = state.activityBridgeQuarantine as Array<{ id: string }>;
    expect(quarantined.map((entry) => entry.id)).toContain('id-32');
    expect(JSON.stringify(quarantined)).not.toContain('subject');
  });
});

describe('activity bridge commit lock', () => {
  it('applies each pull onto the locked row so a stale snapshot cannot erase the other folder', async () => {
    const stored = { delta: { calendarDeltaLink: 'cal-keep' } as Record<string, unknown> };
    const update = vi.fn(async (args: { data: { deltaState: Record<string, unknown> } }) => {
      stored.delta = args.data.deltaState;
    });
    const db = {
      integrationToken: { findFirst: vi.fn(), update },
      $queryRaw: vi.fn(async () => [{ delta_state: stored.delta }]),
      $transaction: async (fn: (tx: unknown) => Promise<void>) => fn(db),
    };

    await commitTokenDeltaState(db, 'tok-1', { calendarDeltaLink: 'cal-keep', mailNextLink: 'inbox-page' }, [
      { page: 'inbox', failedIds: ['poison'] },
    ]);
    // Sent pull started before the inbox commit and still holds the old snapshot.
    await commitTokenDeltaState(db, 'tok-1', { calendarDeltaLink: 'cal-keep', mailSentNextLink: 'sent-page' }, [
      { page: 'sent', failedIds: ['other'] },
    ]);
    const pages = stored.delta.activityBridgeRetryByPage as Record<string, Record<string, number>>;
    expect(pages.inbox?.poison).toBe(1);
    expect(pages.sent?.other).toBe(1);
    expect(stored.delta.mailSentNextLink).toBe('sent-page');
    expect(stored.delta.calendarDeltaLink).toBe('cal-keep');

    await commitTokenDeltaState(db, 'tok-1', { calendarDeltaLink: 'cal-keep', mailNextLink: 'inbox-page' }, [
      { page: 'inbox', failedIds: ['poison'] },
    ]);
    await commitTokenDeltaState(db, 'tok-1', { calendarDeltaLink: 'cal-keep', mailNextLink: 'inbox-page' }, [
      { page: 'inbox', failedIds: ['poison'] },
    ]);
    const last = stored.delta;
    expect((last.activityBridgeRetryByPage as Record<string, Record<string, number>>).inbox?.poison).toBe(
      ACTIVITY_BRIDGE_RETRY_LIMIT,
    );
    expect((last.activityBridgeRetryByPage as Record<string, Record<string, number>>).sent?.other).toBe(1);
    expect(last.activityBridgeQuarantine).toEqual([
      expect.objectContaining({ id: 'poison', attempts: ACTIVITY_BRIDGE_RETRY_LIMIT }),
    ]);
    expect(Object.keys(last.activityBridgeRetryByPage as object).length).toBeLessThanOrEqual(8);
  });
});
