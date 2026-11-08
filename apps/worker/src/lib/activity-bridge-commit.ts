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
  $transaction?: (fn: (tx: TokenTx) => Promise<void>) => Promise<unknown>;
};

/**
 * Persist cursor fields from this run and fold bridge retries into the
 * locked token row. Callers pass the client they already use so the write
 * hits that connection. Two pulls of the same grant serialize on the row
 * (`SELECT … FOR UPDATE` when the client supports it). Each applies its own
 * page deltas to the latest stored counts. A map on a stale snapshot is not
 * enough: the second writer would replace the first.
 */
export async function commitTokenDeltaState(
  db: unknown,
  tokenId: string,
  desired: Record<string, unknown>,
  deltas: ActivityBridgeDelta[],
): Promise<void> {
  const client = db as TokenTx;
  const write = async (tx: TokenTx) => {
    let stored: Record<string, unknown> = {};
    let locked = false;
    if (typeof tx.$queryRaw === 'function') {
      try {
        const rows = await tx.$queryRaw`
          SELECT delta_state FROM integration_tokens WHERE id = ${tokenId}::uuid FOR UPDATE
        `;
        locked = true;
        stored = asRecord(rows[0]?.delta_state);
      } catch {
        locked = false;
      }
    }
    if (!locked) {
      try {
        const row = await tx.integrationToken.findFirst({
          where: { id: tokenId },
          select: { deltaState: true },
        });
        stored = asRecord(row?.deltaState);
      } catch {
        stored = {};
      }
    }
    const merged = mergeBridgeDeltaState(stored, desired, deltas);
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
