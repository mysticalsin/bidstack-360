import { describe, expect, it } from 'vitest';

import { LOGGED_MEETING_PROVIDER, loggedMeetingsInRange, type LoggedMeetingRow } from './calendar-logged-meetings.js';

/**
 * WHY: demo seed logs "Landing zone scoping workshop" as a meeting activity
 * on the UTC day before "today" (daysAgo: 1, 13:00). The calendar week that
 * contains that day only reads calendar_events, which the seed does not
 * fill, so Tuesday renders as an empty day. A blank subject must not become
 * a blank block on that day either.
 */
const WEEK = { from: new Date('2026-11-23T00:00:00.000Z'), to: new Date('2026-11-30T00:00:00.000Z') };

const WORKSHOP_ID = '5eed0003-0000-4000-8000-000000000001';
const OPP_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';

function row(over: Partial<LoggedMeetingRow> = {}): LoggedMeetingRow {
  return {
    id: WORKSHOP_ID,
    type: 'meeting',
    subject: 'Landing zone scoping workshop',
    occurredAt: new Date('2026-11-24T13:00:00.000Z'),
    startTime: null,
    endTime: null,
    entityType: 'opportunity',
    entityId: OPP_ID,
    createdAt: new Date('2026-11-24T13:00:05.000Z'),
    ...over,
  };
}

describe('loggedMeetingsInRange', () => {
  it('puts the demo workshop on the day it happened so that day is not empty', () => {
    const [event] = loggedMeetingsInRange([row()], WEEK, []);
    expect(event).toMatchObject({
      id: WORKSHOP_ID,
      subject: 'Landing zone scoping workshop',
      startAt: '2026-11-24T13:00:00.000Z',
      endAt: '2026-11-24T14:00:00.000Z',
      isAllDay: false,
      provider: LOGGED_MEETING_PROVIDER,
      localOnly: true,
      opportunityId: OPP_ID,
      companyId: null,
      contactId: null,
    });
    expect(event?.startAt.slice(0, 10)).toBe('2026-11-24');
  });

  it('leaves a day empty when the meeting is outside the visible range', () => {
    const before = row({ occurredAt: new Date('2026-11-22T13:00:00.000Z') });
    const onEnd = row({ id: '5eed0003-0000-4000-8000-000000000002', occurredAt: new Date('2026-11-30T00:00:00.000Z') });
    expect(loggedMeetingsInRange([before, onEnd], WEEK, [])).toEqual([]);
  });

  it('keeps a meeting that started before the week and ends inside it', () => {
    const carry = row({
      id: '5eed0003-0000-4000-8000-000000000003',
      subject: 'Architecture review',
      occurredAt: new Date('2026-11-20T15:00:00.000Z'),
      startTime: new Date('2026-11-22T18:00:00.000Z'),
      endTime: new Date('2026-11-23T16:00:00.000Z'),
    });
    const [event] = loggedMeetingsInRange([carry], WEEK, []);
    expect(event).toMatchObject({
      subject: 'Architecture review',
      startAt: '2026-11-22T18:00:00.000Z',
      endAt: '2026-11-23T16:00:00.000Z',
    });
  });

  it('does not paint a blank block when the logged subject is empty', () => {
    const [event] = loggedMeetingsInRange([row({ subject: '   ' })], WEEK, []);
    expect(event?.subject).toBe('Meeting');
    expect(event?.subject.trim()).not.toBe('');
  });

  it('does not turn a call or a note into a calendar event', () => {
    expect(
      loggedMeetingsInRange(
        [row({ type: 'call', subject: 'Procurement timeline check' }), row({ type: 'note', subject: 'Clinical sign-off' })],
        WEEK,
        [],
      ),
    ).toEqual([]);
  });

  it('drops the logged copy when the same meeting is already on the calendar', () => {
    const events = loggedMeetingsInRange([row()], WEEK, [
      { subject: 'Landing zone scoping workshop', startAt: new Date('2026-11-24T13:00:30.000Z') },
    ]);
    expect(events).toEqual([]);
  });

  it('does not attach an entity id that is not a uuid', () => {
    const [event] = loggedMeetingsInRange([row({ entityId: 'not-a-uuid' })], WEEK, []);
    expect(event?.opportunityId).toBeNull();
  });

  it('links a company meeting to the account and a contact meeting to the person', () => {
    const companyId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
    const contactId = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1';
    const events = loggedMeetingsInRange(
      [
        row({ id: '5eed0003-0000-4000-8000-000000000004', entityType: 'company', entityId: companyId, subject: 'HEMA quarterly review' }),
        row({ id: '5eed0003-0000-4000-8000-000000000005', entityType: 'contact', entityId: contactId, subject: 'Intro' }),
      ],
      WEEK,
      [],
    );
    expect(events.map((e) => ({ subject: e.subject, companyId: e.companyId, contactId: e.contactId, opportunityId: e.opportunityId }))).toEqual([
      { subject: 'HEMA quarterly review', companyId, contactId: null, opportunityId: null },
      { subject: 'Intro', companyId: null, contactId, opportunityId: null },
    ]);
  });
});
