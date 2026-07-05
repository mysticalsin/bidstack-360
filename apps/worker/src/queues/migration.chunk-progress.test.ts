// Regression tests for the migration chunk bookkeeping crash window.
//
// WHY this file exists: the chunk audit row's `rowsConsumed` doubles as the
// BullMQ-retry resume cursor, while recordChunkOutcome bumps the
// processedRows/errorRows counters that maybeComplete compares against
// totalRows. If the cursor ever commits WITHOUT the matching counter bump
// (worker killed / transient DB error between the two writes), the retry
// resumes past every row while incrementing the counters by zero — the rows
// are all in the DB but processedRows can never reach totalRows, so the
// import sits in RUNNING forever. These tests simulate that crash window with
// a fake Prisma that has real commit/rollback semantics: writes made through
// $transaction only land if the whole callback resolves.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { state, prismaMock } = vi.hoisted(() => {
  interface AuditRow {
    orgId: string;
    userId: string;
    action: string;
    targetType: string;
    targetId: string;
    diff: { chunkOffset: number; rowsConsumed: number } & Record<string, unknown>;
    at: number;
  }

  const state = {
    auditRows: [] as AuditRow[],
    processedRows: 0,
    errorRows: 0,
    /** Simulates a crash/transient DB error on the counter UPDATE. */
    failNextCounterUpdate: false,
    /** Simulates the symmetric crash on the audit-cursor INSERT. */
    failNextAuditCreate: false,
    seq: 0,
    reset(): void {
      state.auditRows = [];
      state.processedRows = 0;
      state.errorRows = 0;
      state.failNextCounterUpdate = false;
      state.failNextAuditCreate = false;
      state.seq = 0;
    },
  };

  interface TxBuffer {
    auditRows: AuditRow[];
    processedDelta: number;
    errorDelta: number;
  }

  // buffer === null → root client (writes commit immediately, like autocommit).
  // buffer set → transaction client (writes land only if the callback resolves).
  function makeWriter(buffer: TxBuffer | null) {
    return {
      auditLog: {
        create: async ({ data }: { data: Omit<AuditRow, 'at'> }) => {
          if (state.failNextAuditCreate) {
            state.failNextAuditCreate = false;
            throw new Error('simulated crash on audit-cursor insert');
          }
          const row = { ...data, at: state.seq++ };
          (buffer ? buffer.auditRows : state.auditRows).push(row);
          return row;
        },
      },
      migrationJob: {
        update: async ({
          data,
        }: {
          data: { processedRows?: { increment: number }; errorRows?: { increment: number } };
        }) => {
          if (state.failNextCounterUpdate) {
            state.failNextCounterUpdate = false;
            throw new Error('simulated crash on counter update');
          }
          const processed = data.processedRows?.increment ?? 0;
          const errored = data.errorRows?.increment ?? 0;
          if (buffer) {
            buffer.processedDelta += processed;
            buffer.errorDelta += errored;
          } else {
            state.processedRows += processed;
            state.errorRows += errored;
          }
          return {};
        },
      },
      $executeRaw: async () => 0,
    };
  }

  const root = makeWriter(null);

  const prismaMock = {
    ...root,
    auditLog: {
      ...root.auditLog,
      findFirst: async (args: {
        where: {
          orgId: string;
          action: string;
          targetType: string;
          targetId: string;
          diff: { path: string[]; equals: number };
        };
      }) => {
        const match = state.auditRows
          .filter(
            (r) =>
              r.orgId === args.where.orgId &&
              r.action === args.where.action &&
              r.targetType === args.where.targetType &&
              r.targetId === args.where.targetId &&
              r.diff.chunkOffset === args.where.diff.equals,
          )
          .sort((a, b) => b.at - a.at)[0];
        return match ? { diff: match.diff } : null;
      },
    },
    $transaction: async <T>(cb: (tx: ReturnType<typeof makeWriter>) => Promise<T>): Promise<T> => {
      const buffer: TxBuffer = { auditRows: [], processedDelta: 0, errorDelta: 0 };
      const result = await cb(makeWriter(buffer)); // a throw here = rollback: buffer discarded
      state.auditRows.push(...buffer.auditRows);
      state.processedRows += buffer.processedDelta;
      state.errorRows += buffer.errorDelta;
      return result;
    },
  };

  return { state, prismaMock };
});

vi.mock('@bidstack/db', () => ({
  prisma: prismaMock,
  Prisma: {
    PrismaClientKnownRequestError: class PrismaClientKnownRequestError extends Error {
      code = 'P2002';
    },
  },
}));

import { commitChunkProgress, resolveChunkResumeCursor } from './migration.js';

const ORG = '22222222-2222-4222-8222-222222222222';
const USER = '33333333-3333-4333-8333-333333333333';
const JOB = '11111111-1111-4111-8111-111111111111';
const CHUNK_ROWS = 3;

/** One worker attempt over a 3-row chunk, exactly like the queue handler:
 * resolve the resume cursor, "import" the remaining rows, persist bookkeeping. */
async function runAttempt(): Promise<number> {
  const resumeFrom = await resolveChunkResumeCursor(ORG, JOB, 0);
  const processed = CHUNK_ROWS - resumeFrom;
  await commitChunkProgress({
    orgId: ORG,
    userId: USER,
    migrationJobId: JOB,
    entity: 'contact',
    chunkOffset: 0,
    resumeFrom,
    createdIds: [],
    processed,
    errors: [],
  });
  return resumeFrom;
}

describe('migration chunk bookkeeping atomicity', () => {
  beforeEach(() => {
    state.reset();
  });

  it('crash between the cursor write and the counter bump: the retry must recount the full chunk (not strand the job in RUNNING)', async () => {
    // Attempt 1 dies on the counter UPDATE — the exact window this guards.
    state.failNextCounterUpdate = true;
    await expect(runAttempt()).rejects.toThrow(/simulated crash/);

    // The cursor must NOT have survived the crash on its own: a durable cursor
    // with no counter credit makes the retry skip every row AND count zero.
    expect(await resolveChunkResumeCursor(ORG, JOB, 0)).toBe(0);

    // BullMQ retry (attempts: 5) reprocesses and credits every row exactly
    // once, so maybeComplete's processedRows+errorRows >= totalRows can trip.
    await runAttempt();
    expect(state.processedRows).toBe(CHUNK_ROWS);
  });

  it('crash on the cursor insert rolls the counter bump back too — a half-committed pair in either order corrupts the count', async () => {
    // The mirror-image skew (counters durable, cursor lost) would make the
    // retry re-import and re-credit rows it already counted — overshooting
    // processedRows and completing the job early over duplicate rows. Only an
    // atomic pair removes both skews.
    state.failNextAuditCreate = true;
    await expect(runAttempt()).rejects.toThrow(/simulated crash/);

    expect(state.processedRows).toBe(0);

    await runAttempt();
    expect(state.processedRows).toBe(CHUNK_ROWS);
  });

  it('a redelivery after a fully committed chunk adds zero — cursor and counters always describe the same attempt', async () => {
    await runAttempt(); // clean pass
    expect(state.processedRows).toBe(CHUNK_ROWS);

    // BullMQ redelivers (e.g. worker died after commit, before ack): the cursor
    // says "all consumed", so the retry processes nothing and credits nothing.
    const resumeFrom = await runAttempt();
    expect(resumeFrom).toBe(CHUNK_ROWS);
    expect(state.processedRows).toBe(CHUNK_ROWS);
    expect(state.auditRows).toHaveLength(1); // no duplicate undo-trail row either
  });
});
