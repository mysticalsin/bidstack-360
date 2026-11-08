import { describe, expect, it, vi } from 'vitest';

import { CALENDAR_PULL_INCREMENTAL, OUTLOOK_PULL_HISTORICAL, OUTLOOK_PULL_INCREMENTAL } from '@bidstack/shared';

import { commitTokenDeltaState } from './activity-bridge-commit.js';
import {
  ACTIVITY_BRIDGE_ACTIVE_CAP,
  ACTIVITY_BRIDGE_DRAIN_BATCH,
  ACTIVITY_BRIDGE_PENDING_CAP,
  ACTIVITY_BRIDGE_QUARANTINE_CAP,
  ACTIVITY_BRIDGE_RETRY_LIMIT,
  claimActivityBridgeDrain,
  CursorKeyConflictError,
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
    const counts = state.activityBridgeRetryById as Record<string, number>;
    expect(counts.poison).toBeUndefined();
    expect(counts.fresh).toBe(1);
  });

  it('keeps Inbox and Sent counts when the folders interleave', () => {
    const state: Record<string, unknown> = {};
    expect(noteActivityBridgeFailures(state, 'inbox', ['poison']).hold).toBe(true);
    expect(noteActivityBridgeFailures(state, 'sent', ['other']).hold).toBe(true);
    expect(noteActivityBridgeFailures(state, 'inbox', ['poison']).hold).toBe(true);
    const third = noteActivityBridgeFailures(state, 'inbox', ['poison']);
    expect(third.quarantined).toEqual(['poison']);
    const counts = state.activityBridgeRetryById as Record<string, number> | undefined;
    expect(counts?.poison).toBeUndefined();
    // Sent's id was not on the inbox page, so it leaves the active cap and
    // stays in the pending queue. The cursor remains held until that id drains.
    expect(third.hold).toBe(true);
    expect(state.activityBridgePending).toEqual([{ id: 'other', attempts: 1 }]);
    expect(noteActivityBridgeFailures(state, 'sent', []).hold).toBe(true);
    expect(state.activityBridgePending).toEqual([{ id: 'other', attempts: 1 }]);
    expect(state.activityBridgeQuarantine).toEqual([
      expect.objectContaining({ id: 'poison', attempts: ACTIVITY_BRIDGE_RETRY_LIMIT }),
    ]);
  });

  it('applies concurrent pulls in order so neither folder loses an increment', () => {
    const now = '2026-11-08T03:00:00.000Z';
    const start = { calendarDeltaLink: 'cal-keep' };
    const inboxDesired = { ...start, mailNextLink: 'inbox-page' };
    const afterInbox = mergeBridgeDeltaState(start, start, inboxDesired, [
      { page: 'inbox', failedIds: ['poison'] },
    ], now);
    const sentBaseline = { calendarDeltaLink: 'cal-keep' };
    const sentDesired = { calendarDeltaLink: 'cal-keep', mailSentNextLink: 'sent-page' };
    const afterSent = mergeBridgeDeltaState(afterInbox, sentBaseline, sentDesired, [
      { page: 'sent', failedIds: ['other'] },
    ], now);
    const counts = afterSent.activityBridgeRetryById as Record<string, number>;
    expect(afterSent.activityBridgePending).toEqual([{ id: 'poison', attempts: 1 }]);
    expect(counts.other).toBe(1);
    expect(afterSent.calendarDeltaLink).toBe('cal-keep');
    expect(afterSent.mailNextLink).toBe('inbox-page');
    expect(afterSent.mailSentNextLink).toBe('sent-page');
    const again = mergeBridgeDeltaState(afterSent, sentBaseline, sentDesired, [
      { page: 'inbox-next', failedIds: ['poison'] },
    ], now);
    expect((again.activityBridgeRetryById as Record<string, number>).poison).toBe(2);
    expect(again.mailNextLink).toBe('inbox-page');
  });

  it('does not let a stale snapshot delete a newer calendar page or delta', () => {
    const now = '2026-11-08T03:00:00.000Z';
    const stored = { calendarNextLink: 'https://graph/page-2', calendarDeltaLink: 'newer' };
    const baseline = { calendarNextLink: 'https://graph/page-1', calendarDeltaLink: 'old' };
    const desired = { calendarDeltaLink: 'stale-done' };
    // Both keys moved. Returning the locked row would still be a write of a
    // mixed cursor, so the merge aborts and the caller does not persist.
    expect(() => mergeBridgeDeltaState(stored, baseline, desired, [], now)).toThrow(CursorKeyConflictError);
    expect(stored.calendarNextLink).toBe('https://graph/page-2');
    expect(stored.calendarDeltaLink).toBe('newer');
    const owned = mergeBridgeDeltaState(
      { calendarNextLink: 'https://graph/page-1', calendarDeltaLink: 'old', mailNextLink: 'keep' },
      { calendarNextLink: 'https://graph/page-1', calendarDeltaLink: 'old', mailNextLink: 'keep' },
      { calendarDeltaLink: 'done', mailNextLink: 'keep' },
      [],
      now,
    );
    expect(owned.calendarNextLink).toBeUndefined();
    expect(owned.calendarDeltaLink).toBe('done');
    expect(owned.mailNextLink).toBe('keep');
  });

  it('forgets only the oldest quarantined id, and that id starts a new budget', () => {
    // The cap is a bound, not a permanent budget. The forgotten id can be
    // counted again. An id still inside the list does not get a new budget.
    const state: Record<string, unknown> = {};
    const now = '2026-11-08T03:00:00.000Z';
    expect(ACTIVITY_BRIDGE_QUARANTINE_CAP).toBe(50);
    for (let i = 0; i < ACTIVITY_BRIDGE_QUARANTINE_CAP; i++) {
      const id = `id-${i}`;
      noteActivityBridgeFailures(state, 'p', [id], now);
      noteActivityBridgeFailures(state, 'p', [id], now);
      noteActivityBridgeFailures(state, 'p', [id], now);
    }
    noteActivityBridgeFailures(state, 'p', ['id-50'], now);
    noteActivityBridgeFailures(state, 'p', ['id-50'], now);
    noteActivityBridgeFailures(state, 'p', ['id-50'], now);
    const listed = state.activityBridgeQuarantine as Array<{ id: string }>;
    expect(listed).toHaveLength(50);
    expect(listed.some((entry) => entry.id === 'id-0')).toBe(false);
    expect(listed.some((entry) => entry.id === 'id-1')).toBe(true);
    const restarted = noteActivityBridgeFailures(state, 'later', ['id-0'], now);
    expect(restarted.hold).toBe(true);
    expect((state.activityBridgeRetryById as Record<string, number>)['id-0']).toBe(1);
    const remembered = noteActivityBridgeFailures(state, 'later', ['id-1'], now);
    expect(remembered.hold).toBe(true);
    expect(state.activityBridgePending).toEqual([{ id: 'id-0', attempts: 1 }]);
    expect((state.activityBridgeRetryById as Record<string, number> | undefined)?.['id-1']).toBeUndefined();
  });

  it('keeps counting one poison id when the page url changes', () => {
    const state: Record<string, unknown> = {};
    const now = '2026-11-08T03:00:00.000Z';
    expect(noteActivityBridgeFailures(state, 'https://graph/page-a', ['poison'], now).hold).toBe(true);
    expect(noteActivityBridgeFailures(state, 'https://graph/page-b', ['poison'], now).hold).toBe(true);
    const done = noteActivityBridgeFailures(state, 'https://graph/page-c', ['poison'], now);
    expect(done.hold).toBe(false);
    expect(done.quarantined).toEqual(['poison']);
    expect((state.activityBridgeRetryById as Record<string, number> | undefined)?.poison).toBeUndefined();
    expect(state.activityBridgeQuarantine).toEqual([
      expect.objectContaining({ id: 'poison', attempts: ACTIVITY_BRIDGE_RETRY_LIMIT }),
    ]);
    expect(noteActivityBridgeFailures(state, 'https://graph/page-d', ['poison'], now).hold).toBe(false);
  });

  it('folds an older per-page count into the provider id before the next failure', () => {
    const state: Record<string, unknown> = {
      activityBridgeRetryByPage: { 'https://graph/old': { poison: 2 } },
    };
    const done = noteActivityBridgeFailures(state, 'https://graph/new', ['poison'], '2026-11-08T03:00:00.000Z');
    expect(done.hold).toBe(false);
    expect(done.quarantined).toEqual(['poison']);
    expect(state.activityBridgeRetryByPage).toBeUndefined();
  });

  it('holds a full retry map instead of quarantining an id before its budget', () => {
    const state: Record<string, unknown> = {};
    const now = '2026-11-08T03:00:00.000Z';
    const ids = Array.from({ length: 33 }, (_, i) => `id-${i}`);
    const first = noteActivityBridgeFailures(state, 'page-1', ids, now);
    const counts = state.activityBridgeRetryById as Record<string, number>;
    expect(Object.keys(counts)).toHaveLength(32);
    expect(first.hold).toBe(true);
    expect(first.quarantined).toEqual([]);
    expect(state.activityBridgeQuarantine).toBeUndefined();
    expect(counts['id-32']).toBeUndefined();
    const kept = noteActivityBridgeFailures(state, 'page-2', ['id-0', 'id-new'], now);
    const afterKept = state.activityBridgeRetryById as Record<string, number>;
    expect(afterKept['id-0']).toBe(2);
    expect(afterKept['id-new']).toBe(1);
    expect(kept.hold).toBe(true);
    expect(kept.quarantined).toEqual([]);
    const third = noteActivityBridgeFailures(state, 'page-1', ids, now);
    expect(third.quarantined).toEqual(['id-0']);
    expect(third.hold).toBe(true);
    expect((state.activityBridgeRetryById as Record<string, number>)['id-32']).toBe(2);
    expect((state.activityBridgeRetryById as Record<string, number>)['id-0']).toBeUndefined();
    const listed = state.activityBridgeQuarantine as Array<{ id: string; attempts: number }>;
    expect(listed).toEqual([expect.objectContaining({ id: 'id-0', attempts: ACTIVITY_BRIDGE_RETRY_LIMIT })]);
    expect(JSON.stringify(listed)).not.toContain('subject');
  });

  it('keeps ids the current page did not see, and still records the new id', () => {
    // WHY: a full active map of ids from another page used to defer every new
    // id forever. Those ids stay in the pending queue with their attempts.
    // They are not deleted to free a slot, and a full pending queue refuses
    // the newcomer instead of evicting them.
    const state: Record<string, unknown> = {};
    const now = '2026-11-08T03:00:00.000Z';
    const prior = Array.from({ length: ACTIVITY_BRIDGE_ACTIVE_CAP }, (_, index) => `old-${index}`);
    noteActivityBridgeFailures(state, 'page-a', prior, now);
    const next = noteActivityBridgeFailures(state, 'page-b', ['new-1'], now, ['new-seen']);
    const active = state.activityBridgeRetryById as Record<string, number>;
    const pending = state.activityBridgePending as Array<{ id: string; attempts: number }>;
    expect(next.hold).toBe(true);
    expect(active['new-1']).toBe(1);
    expect(pending).toHaveLength(ACTIVITY_BRIDGE_ACTIVE_CAP);
    expect(pending.every((row) => row.attempts === 1)).toBe(true);
    expect(pending.map((row) => row.id)).toEqual(prior);
    const drained = claimActivityBridgeDrain(state);
    expect(drained).toEqual(prior.slice(0, ACTIVITY_BRIDGE_DRAIN_BATCH));
    expect(pending).toHaveLength(ACTIVITY_BRIDGE_ACTIVE_CAP);
    const again = noteActivityBridgeFailures(state, 'drain', drained, now, [], false);
    expect(again.quarantined).toEqual([]);
    const afterDrain = [
      ...((state.activityBridgePending as Array<{ id: string; attempts: number }> | undefined) ?? []),
    ];
    const activeAfter = (state.activityBridgeRetryById as Record<string, number> | undefined) ?? {};
    const oldAttempt = afterDrain.find((row) => row.id === 'old-0')?.attempts ?? activeAfter['old-0'];
    expect(oldAttempt).toBe(2);
    const stuck: Record<string, unknown> = {
      activityBridgeRetryById: Object.fromEntries(
        Array.from({ length: ACTIVITY_BRIDGE_ACTIVE_CAP }, (_, index) => [`live-${index}`, 1]),
      ),
      activityBridgePending: Array.from({ length: ACTIVITY_BRIDGE_PENDING_CAP }, (_, index) => ({
        id: `keep-${index}`,
        attempts: 1,
      })),
    };
    const seen = [...Object.keys(stuck.activityBridgeRetryById as Record<string, number>), 'extra'];
    const blocked = noteActivityBridgeFailures(stuck, 'page-c', ['extra'], now, [], true, seen);
    const kept = stuck.activityBridgePending as Array<{ id: string }>;
    expect(blocked.backpressure).toBe(true);
    expect(kept).toHaveLength(ACTIVITY_BRIDGE_PENDING_CAP);
    expect(kept.some((row) => row.id === 'extra')).toBe(false);
    expect(kept[0]?.id).toBe('keep-0');
    expect(kept.at(-1)?.id).toBe(`keep-${ACTIVITY_BRIDGE_PENDING_CAP - 1}`);
  });

  it('frees a retry slot when an id later succeeds and leaves the other failures', () => {
    // WHY: 32 ids that already succeeded used to sit in the map forever, so a
    // new failure could not be counted and the page stayed held.
    const state: Record<string, unknown> = {};
    const now = '2026-11-08T03:00:00.000Z';
    const ids = Array.from({ length: 32 }, (_, i) => `id-${i}`);
    noteActivityBridgeFailures(state, 'page-1', ids, now);
    const settled = noteActivityBridgeFailures(state, 'page-1', [], now, ['id-0'], true, ids);
    expect(settled.hold).toBe(true);
    const counts = state.activityBridgeRetryById as Record<string, number>;
    expect(counts['id-0']).toBeUndefined();
    expect(counts['id-1']).toBe(1);
    expect(Object.keys(counts)).toHaveLength(31);
    const admitted = noteActivityBridgeFailures(state, 'page-1', ['id-new'], now);
    expect(admitted.hold).toBe(true);
    expect(admitted.quarantined).toEqual([]);
    const after = state.activityBridgeRetryById as Record<string, number>;
    expect(after['id-new']).toBe(1);
    expect(state.activityBridgePending).toEqual(
      expect.arrayContaining([{ id: 'id-1', attempts: 1 }]),
    );
  });

  it('does not drop an unexhausted id that this run did not settle', () => {
    const state: Record<string, unknown> = { activityBridgeRetryById: { poison: 2, other: 1 } };
    const now = '2026-11-08T03:00:00.000Z';
    const merged = mergeBridgeDeltaState(state, state, state, [
      { page: 'inbox', failedIds: ['fresh'], settledIds: ['poison'] },
    ], now);
    const counts = merged.activityBridgeRetryById as Record<string, number>;
    expect(counts.poison).toBeUndefined();
    expect(counts.fresh).toBe(1);
    expect(merged.activityBridgePending).toEqual([{ id: 'other', attempts: 1 }]);
    expect(merged.activityBridgeQuarantine).toBeUndefined();
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
      $executeRaw: vi.fn(async () => 1),
      $queryRaw: vi.fn(async () => [{ delta_state: stored.delta }]),
      $transaction: async (fn: (tx: unknown) => Promise<void>) => fn(db),
    };

    const inboxBaseline = { calendarDeltaLink: 'cal-keep' };
    await commitTokenDeltaState(
      db,
      'tok-1',
      inboxBaseline,
      { calendarDeltaLink: 'cal-keep', mailNextLink: 'inbox-page' },
      [{ page: 'inbox', failedIds: ['poison'] }],
    );
    // Sent pull started before the inbox commit and still holds the old snapshot.
    await commitTokenDeltaState(
      db,
      'tok-1',
      { calendarDeltaLink: 'cal-keep' },
      { calendarDeltaLink: 'cal-keep', mailSentNextLink: 'sent-page' },
      [{ page: 'sent', failedIds: ['other'] }],
    );
    const counts = stored.delta.activityBridgeRetryById as Record<string, number>;
    expect(stored.delta.activityBridgePending).toEqual([{ id: 'poison', attempts: 1 }]);
    expect(counts.other).toBe(1);
    expect(stored.delta.mailNextLink).toBe('inbox-page');
    expect(stored.delta.mailSentNextLink).toBe('sent-page');
    expect(stored.delta.calendarDeltaLink).toBe('cal-keep');

    const later = { calendarDeltaLink: 'cal-keep', mailNextLink: 'inbox-page', mailSentNextLink: 'sent-page' };
    await commitTokenDeltaState(db, 'tok-1', later, later, [{ page: 'inbox-2', failedIds: ['poison'] }]);
    await commitTokenDeltaState(db, 'tok-1', later, later, [{ page: 'inbox-3', failedIds: ['poison'] }]);
    const last = stored.delta;
    expect(last.activityBridgeRetryById).toBeUndefined();
    expect(last.activityBridgePending).toEqual([{ id: 'other', attempts: 1 }]);
    expect(last.mailSentNextLink).toBe('sent-page');
    expect(last.activityBridgeQuarantine).toEqual([
      expect.objectContaining({ id: 'poison', attempts: ACTIVITY_BRIDGE_RETRY_LIMIT }),
    ]);
  });

  it('does not write when the row lock fails', async () => {
    const update = vi.fn();
    const findFirst = vi.fn();
    const db = {
      integrationToken: { findFirst, update },
      $executeRaw: vi.fn(async () => 1),
      $queryRaw: vi.fn(async () => {
        throw new Error('canceling statement due to lock timeout');
      }),
      $transaction: async (fn: (tx: unknown) => Promise<void>) => fn(db),
    };
    await expect(
      commitTokenDeltaState(db, 'tok-1', { calendarDeltaLink: 'cal-keep' }, { calendarDeltaLink: 'cal-next' }, []),
    ).rejects.toThrow(/lock timeout/);
    expect(update).not.toHaveBeenCalled();
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('sets a transaction-local lock wait and stops when that statement fails', async () => {
    const update = vi.fn();
    const executeRaw = vi.fn(async () => {
      throw new Error('lock_timeout rejected');
    });
    const db = {
      integrationToken: { findFirst: vi.fn(), update },
      $executeRaw: executeRaw,
      $queryRaw: vi.fn(async () => [{ delta_state: {} }]),
      $transaction: async (fn: (tx: unknown) => Promise<void>) => fn(db),
    };
    await expect(
      commitTokenDeltaState(db, 'tok-1', {}, { mailNextLink: 'inbox-page' }, []),
    ).rejects.toThrow(/lock_timeout rejected/);
    expect(String(executeRaw.mock.calls[0]?.[0])).toContain('lock_timeout');
    expect(db.$queryRaw).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('refuses a client that cannot lock and is not an explicit test adapter', async () => {
    const update = vi.fn();
    const db = {
      integrationToken: { findFirst: vi.fn(async () => ({ deltaState: {} })), update },
    };
    await expect(commitTokenDeltaState(db, 'tok-1', {}, { mailNextLink: 'x' }, [])).rejects.toThrow(/unlocked cursor write/);
    expect(update).not.toHaveBeenCalled();
  });

  it('refuses a row lock that cannot set lock_timeout', async () => {
    const update = vi.fn();
    const db = {
      integrationToken: { findFirst: vi.fn(), update },
      $queryRaw: vi.fn(async () => [{ delta_state: {} }]),
      $transaction: async (fn: (tx: unknown) => Promise<void>) => fn(db),
    };
    await expect(commitTokenDeltaState(db, 'tok-1', {}, { mailNextLink: 'x' }, [])).rejects.toThrow(/missing \$queryRaw, \$executeRaw, or a transaction/);
    expect(update).not.toHaveBeenCalled();
    expect(db.$queryRaw).not.toHaveBeenCalled();
  });

  it('does not let the test adapter skip a lock when any database method exists', async () => {
    const update = vi.fn();
    const db = {
      unlockedCursorTestAdapter: true,
      integrationToken: { findFirst: vi.fn(), update },
      $transaction: async (fn: (tx: unknown) => Promise<void>) => fn(db),
    };
    await expect(commitTokenDeltaState(db, 'tok-1', {}, { mailNextLink: 'x' }, [])).rejects.toThrow(
      /missing \$queryRaw, \$executeRaw, or a transaction/,
    );
    expect(update).not.toHaveBeenCalled();
  });

  it('lets an explicit test adapter write without claiming the write was locked', async () => {
    const update = vi.fn();
    const db = {
      unlockedCursorTestAdapter: true,
      integrationToken: {
        findFirst: vi.fn(async () => ({ deltaState: { calendarDeltaLink: 'cal-keep' } })),
        update,
      },
    };
    await commitTokenDeltaState(db, 'tok-1', { calendarDeltaLink: 'cal-keep' }, { calendarDeltaLink: 'cal-keep', mailNextLink: 'inbox' }, []);
    expect(update).toHaveBeenCalledOnce();
    expect(db.integrationToken.findFirst).toHaveBeenCalled();
  });

  it('aborts a mixed nextLink and delta instead of keeping the stale page', async () => {
    // WHY: the next read prefers calendarNextLink. Writing a new delta while
    // leaving a conflicting nextLink would resume on the stale page.
    const stored = {
      delta: { calendarNextLink: 'https://graph/page-2', calendarDeltaLink: 'old' } as Record<string, unknown>,
    };
    const update = vi.fn(async (args: { data: { deltaState: Record<string, unknown> } }) => {
      stored.delta = args.data.deltaState;
    });
    const db = {
      integrationToken: { findFirst: vi.fn(), update },
      $executeRaw: vi.fn(async () => 1),
      $queryRaw: vi.fn(async () => [{ delta_state: stored.delta }]),
      $transaction: async (fn: (tx: unknown) => Promise<void>) => fn(db),
    };
    await expect(
      commitTokenDeltaState(
        db,
        'tok-1',
        { calendarNextLink: 'https://graph/page-1', calendarDeltaLink: 'old' },
        { calendarDeltaLink: 'done' },
        [],
      ),
    ).rejects.toThrow(CursorKeyConflictError);
    expect(update).not.toHaveBeenCalled();
    expect(stored.delta.calendarNextLink).toBe('https://graph/page-2');
    expect(stored.delta.calendarDeltaLink).toBe('old');
  });

  it('does not write when a stale snapshot would replace a deleted nextLink', async () => {
    const stored = { delta: { calendarDeltaLink: 'newer' } as Record<string, unknown> };
    const update = vi.fn();
    const db = {
      integrationToken: { findFirst: vi.fn(), update },
      $executeRaw: vi.fn(async () => 1),
      $queryRaw: vi.fn(async () => [{ delta_state: stored.delta }]),
      $transaction: async (fn: (tx: unknown) => Promise<void>) => fn(db),
    };
    await expect(
      commitTokenDeltaState(
        db,
        'tok-1',
        { calendarNextLink: 'https://graph/page-1', calendarDeltaLink: 'old' },
        { calendarNextLink: 'https://graph/page-1', calendarDeltaLink: 'stale-done' },
        [{ page: 'https://graph/page-1', failedIds: ['poison'] }],
      ),
    ).rejects.toThrow(/Cursor key conflict/);
    expect(update).not.toHaveBeenCalled();
    expect(stored.delta).toEqual({ calendarDeltaLink: 'newer' });
  });

  it('persists when the locked cursor already matches and still applies a success', async () => {
    const stored = {
      delta: {
        calendarDeltaLink: 'done',
        activityBridgeRetryById: { poison: 1, other: 2 },
      } as Record<string, unknown>,
    };
    const update = vi.fn(async (args: { data: { deltaState: Record<string, unknown> } }) => {
      stored.delta = args.data.deltaState;
    });
    const db = {
      integrationToken: { findFirst: vi.fn(), update },
      $executeRaw: vi.fn(async () => 1),
      $queryRaw: vi.fn(async () => [{ delta_state: stored.delta }]),
      $transaction: async (fn: (tx: unknown) => Promise<void>) => fn(db),
    };
    await commitTokenDeltaState(
      db,
      'tok-1',
      { calendarNextLink: 'https://graph/page-1', calendarDeltaLink: 'old' },
      { calendarDeltaLink: 'done' },
      [{ page: 'https://graph/page-2', failedIds: [], settledIds: ['poison'] }],
    );
    expect(update).toHaveBeenCalledOnce();
    expect(stored.delta.calendarDeltaLink).toBe('done');
    expect(stored.delta.calendarNextLink).toBeUndefined();
    expect(stored.delta.activityBridgeRetryById).toBeUndefined();
    expect(stored.delta.activityBridgePending).toEqual([{ id: 'other', attempts: 2 }]);
  });

  it('leaves lock-timeout retries to the pull jobs that already back off', () => {
    expect(CALENDAR_PULL_INCREMENTAL.defaultJobOptions.attempts).toBe(3);
    expect(CALENDAR_PULL_INCREMENTAL.defaultJobOptions.backoff).toEqual({ type: 'exponential', delay: 5_000 });
    expect(OUTLOOK_PULL_INCREMENTAL.defaultJobOptions.attempts).toBe(5);
    expect(OUTLOOK_PULL_INCREMENTAL.defaultJobOptions.backoff).toEqual({ type: 'exponential', delay: 10_000 });
    expect(OUTLOOK_PULL_HISTORICAL.defaultJobOptions.attempts).toBe(3);
    expect(OUTLOOK_PULL_HISTORICAL.defaultJobOptions.backoff).toEqual({ type: 'fixed', delay: 30_000 });
  });
});

describe('noteActivityBridgeFailures with a full pending queue', () => {
  it('keeps an unseen id in the retry map and reports backpressure instead of throwing', () => {
    const state: Record<string, unknown> = {
      activityBridgeRetryById: { unseen: 1 },
      activityBridgePending: Array.from({ length: ACTIVITY_BRIDGE_PENDING_CAP }, (_, i) => ({
        id: `queued-${i}`,
        attempts: 1,
      })),
    };
    const out = noteActivityBridgeFailures(state, 'page-2', [], '2026-11-08T00:00:00.000Z', ['visited']);
    expect(out).toMatchObject({ hold: true, backpressure: true, pending: ACTIVITY_BRIDGE_PENDING_CAP });
    expect(state.activityBridgeRetryById).toEqual({ unseen: 1 });
  });
});
