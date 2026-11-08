import { mergeBridgeDeltaState, type ActivityBridgeDelta, type LegacyBridgeMigration } from './comms-capture.js';

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
 * Config guard for a fake client that has none of `$transaction`,
 * `$queryRaw`, or `$executeRaw`. It is not a claim that a production process
 * is unable to set a flag. If any of those methods exists, the flag is
 * ignored and the write is refused. Production Prisma has all three, so the
 * flag does not unlock a real client.
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
 * real client. `lock_timeout` is always set before `FOR UPDATE`. A conflicting
 * cursor key aborts before the update, so a nextLink and a delta link from
 * the same provider are not mixed. If the locked row already matches this
 * run, the update still runs and is idempotent. This function does not retry:
 * calendar incremental jobs already use 3 attempts with exponential backoff
 * from 5s, and Outlook incremental jobs use 5 attempts with exponential
 * backoff from 10s. The thrown error is what those jobs retry. Postgres drops
 * the row lock when the transaction ends.
 */
export async function commitTokenDeltaState(
  db: unknown,
  tokenId: string,
  baseline: Record<string, unknown>,
  desired: Record<string, unknown>,
  deltas: ActivityBridgeDelta[],
  migrations: LegacyBridgeMigration[] = [],
): Promise<void> {
  const client = db as TokenTx;
  const write = async (tx: TokenTx) => {
    let stored: Record<string, unknown>;
    const hasQuery = typeof tx.$queryRaw === 'function';
    const hasExec = typeof tx.$executeRaw === 'function';
    const hasTx = typeof client.$transaction === 'function';
    if (hasQuery || hasExec || hasTx) {
      if (!tx.$queryRaw || !tx.$executeRaw || !hasTx) {
        throw new Error(
          'Refusing a cursor write. The client is missing $queryRaw, $executeRaw, or a transaction, so the row lock would not be held.',
        );
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
    const merged = mergeBridgeDeltaState(stored, baseline, desired, deltas, new Date().toISOString(), migrations);
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
