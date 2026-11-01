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

  it('does not score a deleted stage, and a lost flag beats a won flag', async () => {
    // WHY: a removed stage was still a loss in the owner close rate, and a
    // deal flagged both ways was counted as a win and a loss.
    const count = vi.fn(async () => 0);
    const activity = {
      groupBy: vi.fn(async () => []),
      findFirst: vi.fn(async () => null),
      findMany: vi.fn(async () => []),
    };
    const deleted = {
      activity,
      opportunity: {
        findFirst: vi.fn(async () => ({
          valueMicros: 1n,
          probability: 10,
          dueDate: null,
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          ownerId: 'owner-1',
          stage: 's2_sent',
          pipelineStage: {
            probability: 0,
            isWon: true,
            isLost: true,
            deletedAt: new Date('2026-02-01T00:00:00.000Z'),
          },
          _count: { contactLinks: 0 },
          intel: {},
        })),
        count,
      },
    };
    const removed = await extractOpportunityFeatures('opp-1', 'org-1', deleted as never);
    expect(valueOf(removed!, 'is_won')).toBe(0);
    expect(valueOf(removed!, 'is_lost')).toBe(0);
    const wheres = count.mock.calls.map((call) => (call[0] as { where: unknown }).where);
    expect(wheres[0]).toMatchObject({
      NOT: {
        OR: [{ stage: 'closed_lost' }, { pipelineStage: { is: { deletedAt: null, isLost: true } } }],
      },
      OR: [
        { stage: 'closed_won' },
        { pipelineStage: { is: { deletedAt: null, isWon: true, isLost: false } } },
      ],
    });
    expect(wheres[1]).toMatchObject({
      OR: [{ stage: 'closed_lost' }, { pipelineStage: { is: { deletedAt: null, isLost: true } } }],
    });

    const both = {
      activity,
      opportunity: {
        findFirst: vi.fn(async () => ({
          valueMicros: 1n,
          probability: 10,
          dueDate: null,
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          ownerId: null,
          stage: 'closed_won',
          pipelineStage: { probability: 0, isWon: true, isLost: true, deletedAt: null },
          _count: { contactLinks: 0 },
          intel: {},
        })),
        count,
      },
    };
    const flagged = await extractOpportunityFeatures('opp-2', 'org-1', both as never);
    expect(valueOf(flagged!, 'is_won')).toBe(0);
    expect(valueOf(flagged!, 'is_lost')).toBe(1);

    const enumWon = {
      activity,
      opportunity: {
        findFirst: vi.fn(async () => ({
          valueMicros: 1n,
          probability: 10,
          dueDate: null,
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          ownerId: null,
          stage: 'closed_won',
          pipelineStage: null,
          _count: { contactLinks: 0 },
          intel: {},
        })),
        count,
      },
    };
    const recorded = await extractOpportunityFeatures('opp-3', 'org-1', enumWon as never);
    expect(valueOf(recorded!, 'is_won')).toBe(1);
    expect(valueOf(recorded!, 'is_lost')).toBe(0);
  });
});
