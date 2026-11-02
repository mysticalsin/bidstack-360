/**
 * Signals one account-watchdog query may return.
 * The list draws fifty. A fixed take of fifty dropped a later signal, so
 * those fifty read as every signal. One row past those fifty is the probe.
 * It is not shown, and it is not a total.
 */
export const ACCOUNT_WATCH_EVENTS_DRAWN = 50;

export function accountWatchEventTake(): number {
  return ACCOUNT_WATCH_EVENTS_DRAWN + 1;
}
