type ErrorLog = { error(obj: object, msg: string): void };

/**
 * Undo what a failed migration start already wrote. Every step runs even if
 * an earlier one fails, and a failing step is logged with the start's own
 * error as its cause; nothing is thrown, so the caller rethrows that original
 * error (a 503 stays a 503 instead of becoming the cleanup's 500).
 */
export async function discardFailedStart(
  cause: unknown,
  log: ErrorLog,
  steps: ReadonlyArray<readonly [step: string, run: () => Promise<unknown>]>,
): Promise<void> {
  for (const [step, run] of steps) {
    try {
      await run();
    } catch (err) {
      log.error({ err, cause, step }, 'could not clean up a failed migration start');
    }
  }
}
