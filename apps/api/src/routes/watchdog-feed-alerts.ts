/**
 * Alerts one org-dashboard watchdog query may return.
 * The pulse draws five. A fixed take of five dropped a sixth signal, so
 * five alerts read as every new signal. One row past those five is the
 * probe. It is not shown, and it is not a total.
 */
export const WATCHDOG_FEED_ALERTS_DRAWN = 5;

export function watchdogFeedAlertTake(): number {
  return WATCHDOG_FEED_ALERTS_DRAWN + 1;
}
