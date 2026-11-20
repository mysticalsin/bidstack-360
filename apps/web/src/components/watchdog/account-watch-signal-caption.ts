/** Signals the account watchdog list draws. One loaded row past this is not shown. */
export const ACCOUNT_WATCH_EVENTS_DRAWN = 50;

/**
 * Signal count for the account watchdog. A longer loaded list is the latest
 * signals, not every signal. A list that fits keeps "N signals".
 * No signal total is invented.
 */
export function accountWatchSignalCaption(count: number, pageContinues: boolean): string {
  if (pageContinues) {
    return `${count} in the latest ${count}, not every signal`;
  }
  return `${count} ${count === 1 ? 'signal' : 'signals'}`;
}
