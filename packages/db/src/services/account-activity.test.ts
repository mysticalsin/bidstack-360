import { describe, expect, it } from 'vitest';

import { bucketActivitySummary, weekStartIn } from './account-activity.js';
import { ingestContentHash, ingestDedupeKey } from './activity-ingest.js';

const ORG_A = '00000000-0000-4000-8000-00000000000a';
const ORG_B = '00000000-0000-4000-8000-00000000000b';

describe('ingestDedupeKey', () => {
  it('is stable for the same org, source and external id', () => {
    expect(ingestDedupeKey(ORG_A, 'hubspot', 'call-1')).toBe(
      ingestDedupeKey(ORG_A, 'hubspot', 'call-1'),
    );
  });

  // Activity.idempotencyKey is globally unique, so two tenants pushing the same
  // CRM id must never collide on one row.
  it('differs across orgs and sources', () => {
    const a = ingestDedupeKey(ORG_A, 'hubspot', 'call-1');
    expect(ingestDedupeKey(ORG_B, 'hubspot', 'call-1')).not.toBe(a);
    expect(ingestDedupeKey(ORG_A, 'dust', 'call-1')).not.toBe(a);
  });

  it('fits the 128 character idempotency column', () => {
    expect(ingestDedupeKey(ORG_A, 'x'.repeat(40), 'y'.repeat(200)).length).toBeLessThanOrEqual(128);
  });

  it('treats the source case-insensitively so HubSpot and hubspot dedupe together', () => {
    expect(ingestDedupeKey(ORG_A, 'HubSpot', 'call-1')).toBe(
      ingestDedupeKey(ORG_A, 'hubspot', 'call-1'),
    );
  });
});

describe('ingestContentHash', () => {
  const item = {
    externalSource: 'hubspot',
    externalId: 'call-1',
    type: 'call' as const,
    occurredAt: '2026-11-02T14:30:00Z',
    subject: 'Discovery',
    company: { domain: 'dnb.no' },
  };

  it('ignores key order so a replay with reordered JSON is unchanged', () => {
    const reordered = {
      company: { domain: 'dnb.no' },
      subject: 'Discovery',
      occurredAt: '2026-11-02T14:30:00Z',
      type: 'call' as const,
      externalId: 'call-1',
      externalSource: 'hubspot',
    };
    expect(ingestContentHash(reordered)).toBe(ingestContentHash(item));
  });

  it('changes when the content changes', () => {
    expect(ingestContentHash({ ...item, subject: 'Follow-up' })).not.toBe(ingestContentHash(item));
  });
});

describe('weekStartIn', () => {
  it('returns the Monday of the week in the given time zone', () => {
    // Sunday 23:30 UTC is already Monday in Oslo.
    expect(weekStartIn(new Date('2026-11-08T23:30:00Z'), 'UTC')).toBe('2026-11-02');
    expect(weekStartIn(new Date('2026-11-08T23:30:00Z'), 'Europe/Oslo')).toBe('2026-11-09');
  });
});

describe('bucketActivitySummary', () => {
  const now = new Date('2026-11-06T12:00:00Z');

  it('counts activity by local hour of day and by type', () => {
    const summary = bucketActivitySummary({
      now,
      tz: 'America/Toronto',
      weeks: 4,
      activities: [
        { type: 'call', status: 'completed', occurredAt: new Date('2026-11-03T14:10:00Z') },
        { type: 'call', status: 'completed', occurredAt: new Date('2026-11-04T14:50:00Z') },
        { type: 'email', status: 'completed', occurredAt: new Date('2026-11-04T20:00:00Z') },
      ],
      overdue: [],
    });
    expect(summary.byHour).toHaveLength(24);
    // 14:xx UTC is 09:xx in Toronto in November (UTC-5).
    expect(summary.byHour[9]).toMatchObject({ hour: 9, call: 2, email: 0 });
    expect(summary.byHour[15]).toMatchObject({ hour: 15, email: 1 });
    expect(summary.total).toBe(3);
  });

  it('returns one row per week, oldest first, ending with the current week', () => {
    const summary = bucketActivitySummary({ now, tz: 'UTC', weeks: 4, activities: [], overdue: [] });
    expect(summary.weekly.map((w) => w.weekStart)).toEqual([
      '2026-10-12',
      '2026-10-19',
      '2026-10-26',
      '2026-11-02',
    ]);
  });

  it('puts each activity in its week and type column', () => {
    const summary = bucketActivitySummary({
      now,
      tz: 'UTC',
      weeks: 4,
      activities: [
        { type: 'meeting', status: 'completed', occurredAt: new Date('2026-10-20T10:00:00Z') },
        { type: 'stage_change', status: 'completed', occurredAt: new Date('2026-11-05T10:00:00Z') },
        { type: 'note', status: 'completed', occurredAt: new Date('2026-11-05T11:00:00Z') },
      ],
      overdue: [],
    });
    expect(summary.weekly[1]).toMatchObject({ weekStart: '2026-10-19', meeting: 1 });
    expect(summary.weekly[3]).toMatchObject({ weekStart: '2026-11-02', stage_change: 1, note: 1 });
  });

  it('skips cancelled and not-yet-happened activity, and activity outside the window', () => {
    const summary = bucketActivitySummary({
      now,
      tz: 'UTC',
      weeks: 4,
      activities: [
        { type: 'call', status: 'cancelled', occurredAt: new Date('2026-11-03T10:00:00Z') },
        { type: 'call', status: 'planned', occurredAt: new Date('2026-11-20T10:00:00Z') },
        { type: 'call', status: 'completed', occurredAt: new Date('2026-01-01T10:00:00Z') },
      ],
      overdue: [],
    });
    expect(summary.total).toBe(0);
  });

  it('hangs overdue follow-ups below the line in the week they fell due', () => {
    const summary = bucketActivitySummary({
      now,
      tz: 'UTC',
      weeks: 4,
      activities: [],
      overdue: [
        { dueAt: new Date('2026-10-21T09:00:00Z') },
        { dueAt: new Date('2026-10-22T09:00:00Z') },
        // Older than the window: still counted in the total, not drawn.
        { dueAt: new Date('2026-06-01T09:00:00Z') },
      ],
    });
    expect(summary.weekly[1]?.overdue).toBe(2);
    expect(summary.overdue.count).toBe(3);
    expect(summary.overdue.oldestDueAt).toBe('2026-06-01T09:00:00.000Z');
  });
});
