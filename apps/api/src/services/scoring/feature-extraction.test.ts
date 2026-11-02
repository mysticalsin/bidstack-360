/**
 * Unit tests pinning the BOUNDED activity aggregation in
 * extractOpportunityFeatures.
 *
 * WHY these tests matter:
 *   The opportunity feature vector feeds the scoring model. An active deal can
 *   accumulate thousands of Activity rows, so the per-opportunity feature build
 *   must NOT pull the full history into memory. The aggregation was rewritten
 *   from one unbounded findMany + in-process filtering to:
 *     - groupBy(type)        → meeting / email COUNTS (must stay exact totals)
 *     - findFirst desc       → most-recent activity timestamp
 *     - findFirst desc + type→ most-recent stage_change timestamp
 *   These tests fail the moment someone reintroduces an unbounded findMany over
 *   activities, or bounds the counts with a `take` (which would silently
 *   truncate num_meetings_held / num_emails_sent_received and degrade scoring).
 */

import { describe, expect, it, vi } from 'vitest';

import { extractOpportunityFeatures } from './feature-extraction.js';

type GroupByRow = { type: string; _count: { _all: number } };

interface ActivityStubCalls {
  groupBy: ReturnType<typeof vi.fn>;
  findFirst: ReturnType<typeof vi.fn>;
  findMany: ReturnType<typeof vi.fn>;
}

/** Build a minimal prisma stub exposing only the surface the function touches. */
function buildDbStub(opts: {
  typeCounts: GroupByRow[];
  lastActivityAt: Date | null;
  lastStageChangeAt: Date | null;
}): { db: unknown; activity: ActivityStubCalls } {
  const createdAt = new Date('2026-01-01T00:00:00.000Z');

  const activity: ActivityStubCalls = {
    groupBy: vi.fn(async () => opts.typeCounts),
    // findFirst is called twice: [0] = most-recent activity, [1] = most-recent
    // stage_change. Route by the presence of a `type` filter in the where.
    findFirst: vi.fn(async (args: { where: { type?: string } }) => {
      if (args.where.type === 'stage_change') {
        return opts.lastStageChangeAt ? { occurredAt: opts.lastStageChangeAt } : null;
      }
      return opts.lastActivityAt ? { occurredAt: opts.lastActivityAt } : null;
    }),
    // Must NEVER be called — its presence would mean the unbounded scan is back.
    findMany: vi.fn(async () => {
      throw new Error('activity.findMany must not be used by the bounded path');
    }),
  };

  const opportunity = {
    findFirst: vi.fn(async () => ({
      valueMicros: 1_000_000n,
      probability: 50,
      dueDate: null,
      createdAt,
      ownerId: null,
      pipelineStage: { probability: 60, isWon: false, isLost: false },
      _count: { contactLinks: 2 },
      intel: {},
    })),
    count: vi.fn(async () => 0),
  };

  return { db: { activity, opportunity }, activity };
}

function valueOf(vector: { names: string[]; values: number[] }, name: string): number {
  const idx = vector.names.indexOf(name);
  if (idx === -1) throw new Error(`feature ${name} missing from vector`);
  return vector.values[idx]!;
}

describe('extractOpportunityFeatures — bounded activity aggregation', () => {
  it('derives meeting/email counts from groupBy totals (exact, not truncated)', async () => {
    const { db } = buildDbStub({
      typeCounts: [
        { type: 'meeting', _count: { _all: 12 } },
        { type: 'email', _count: { _all: 30 } },
        { type: 'email_opened', _count: { _all: 8 } },
        { type: 'email_clicked', _count: { _all: 2 } },
        { type: 'note', _count: { _all: 5 } },
      ],
      lastActivityAt: new Date('2026-02-01T00:00:00.000Z'),
      lastStageChangeAt: new Date('2026-01-20T00:00:00.000Z'),
    });

    const vector = await extractOpportunityFeatures('opp-1', 'org-1', db as never);
    expect(vector).not.toBeNull();
    // meetings = 12; emails = email(30) + email_opened(8) + email_clicked(2) = 40.
    expect(valueOf(vector!, 'num_meetings_held')).toBe(12);
    expect(valueOf(vector!, 'num_emails_sent_received')).toBe(40);
  });

  it('never issues an unbounded findMany over the activity history', async () => {
    const { db, activity } = buildDbStub({
      typeCounts: [{ type: 'meeting', _count: { _all: 1 } }],
      lastActivityAt: new Date('2026-02-01T00:00:00.000Z'),
      lastStageChangeAt: null,
    });

    await extractOpportunityFeatures('opp-1', 'org-1', db as never);

    expect(activity.findMany).not.toHaveBeenCalled();
    expect(activity.groupBy).toHaveBeenCalledTimes(1);
    // Two bounded findFirst lookups: last activity + last stage change.
    expect(activity.findFirst).toHaveBeenCalledTimes(2);
  });

  it('falls back to opp.createdAt when there is no stage_change row', async () => {
    const { db } = buildDbStub({
      typeCounts: [],
      lastActivityAt: null,
      lastStageChangeAt: null,
    });

    const vector = await extractOpportunityFeatures('opp-1', 'org-1', db as never);
    expect(vector).not.toBeNull();
    // No counts → zero meetings/emails; days_in_current_stage falls back to age
    // from createdAt (a finite, non-negative number, not NaN).
    expect(valueOf(vector!, 'num_meetings_held')).toBe(0);
    expect(valueOf(vector!, 'num_emails_sent_received')).toBe(0);
    expect(Number.isFinite(valueOf(vector!, 'days_in_current_stage'))).toBe(true);
  });
});
