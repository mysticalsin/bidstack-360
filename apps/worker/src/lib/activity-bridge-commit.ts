import { mergeBridgeDeltaState, type ActivityBridgeDelta } from './comms-capture.js';

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

type TokenTx = {
  integrationToken: {
    findFirst: (args: unknown) => Promise<{ deltaState?: unknown } | null>;
    update: (args: unknown) => Promise<unknown>;
  };
  $queryRaw?: (query: TemplateStringsArray, ...values: unknown[]) => Promise<Array<{ delta_state?: unknown }>>;
  $executeRaw?: (query: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>;
  $transaction?: (fn: (tx: TokenTx) => Promise<void>) => Promise<unknown>;
  unlockedCursorTestAdapter?: boolean;
};

/**
 * How long to wait for the token row lock. Postgres releases that lock when
 * the transaction commits or rolls back. This is not an application lease:
 * nothing is retained after the transaction ends. On timeout the statement
 * fails and the transaction rolls back, so the cursor is not written.
 */
const LOCK_TIMEOUT = '2000';

/**
 * Test doubles that cannot offer a row lock set this. Production Prisma has
 * `$transaction`, `$queryRaw`, and `$executeRaw` and must not set it. A
 * client missing either SQL method is refused instead of writing unlocked.
 */
export const UNLOCKED_CURSOR_TEST_ADAPTER = 'unlockedCursorTestAdapter';

/**
 * Persist this run's cursor edits onto the locked token row and fold bridge
 * retries into the counts already stored there. Callers pass the snapshot
 * they started from and the snapshot they want now. Only keys that differ
 * are written, so a concurrent folder or provider keeps the keys this run
 * did not change.
 *
 * A lock or read error aborts the write. There is no unlocked fallback on a
 * real client. `lock_timeout` is always set before `FOR UPDATE`. This
 * function does not retry: calendar incremental jobs already use 3 attempts
 * with exponential backoff from 5s, and Outlook incremental jobs use 5
 * attempts with exponential backoff from 10s. The thrown error is what those
 * jobs retry. Postgres drops the row lock when the transaction ends.
 */
export async function commitTokenDeltaState(
  db: unknown,
  tokenId: string,
  baseline: Record<string, unknown>,
  desired: Record<string, unknown>,
  deltas: ActivityBridgeDelta[],
): Promise<void> {
  const client = db as TokenTx;
  const write = async (tx: TokenTx) => {
    let stored: Record<string, unknown>;
    const canLock = typeof tx.$queryRaw === 'function' && typeof tx.$executeRaw === 'function';
    if (canLock) {
      if (typeof client.$transaction !== 'function') {
        throw new Error('Refusing a cursor row lock outside a transaction');
      }
      await tx.$executeRaw`SELECT set_config('lock_timeout', ${LOCK_TIMEOUT}, true)`;
      const rows = await tx.$queryRaw`
        SELECT delta_state FROM integration_tokens WHERE id = ${tokenId}::uuid FOR UPDATE
      `;
      if (!rows[0]) throw new Error(`integration token ${tokenId} not found for cursor update`);
      stored = asRecord(rows[0].delta_state);
    } else if (tx.unlockedCursorTestAdapter === true) {
      const row = await tx.integrationToken.findFirst({
        where: { id: tokenId },
        select: { deltaState: true },
      });
      stored = row ? asRecord(row.deltaState) : baseline;
    } else {
      throw new Error(
        'Refusing an unlocked cursor write. The client needs $queryRaw and $executeRaw so the row lock and lock_timeout are both set.',
      );
    }
    const merged = mergeBridgeDeltaState(stored, baseline, desired, deltas);
    await tx.integrationToken.update({
      where: { id: tokenId },
      data: { deltaState: merged, lastSyncedAt: new Date() },
    });
  };

  if (typeof client.$transaction === 'function') {
    await client.$transaction(async (tx) => write(tx));
    return;
  }
  await write(client);
}
