/** Signals the org pulse draws from the watchdog feed. One loaded row past this is not shown. */
export const WATCHDOG_FEED_ALERTS_DRAWN = 5;

/**
 * Watchdog caption for the org pulse. A longer loaded list is the latest
 * signals, not every signal. A list that fits keeps the old watchdog line.
 * No signal total is invented.
 */
export function watchdogAlertCaption(fresh: number, risks: number, pageContinues: boolean): string {
  if (pageContinues) {
    return `${WATCHDOG_FEED_ALERTS_DRAWN} in the latest ${WATCHDOG_FEED_ALERTS_DRAWN}, not every signal`;
  }
  if (fresh <= 0) return 'Watchdog: all quiet';
  const signals = `Watchdog: ${fresh} new signal${fresh === 1 ? '' : 's'}`;
  if (risks <= 0) return signals;
  return `${signals} · ${risks} risk${risks === 1 ? '' : 's'}`;
}
