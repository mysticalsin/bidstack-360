/**
 * Closed projects one account-watchdog query may return.
 * The track record draws fifty. A fixed take of fifty dropped a later
 * project, so those fifty read as every closed bid. One row past those
 * fifty is the probe. It is not shown, and it is not a total.
 */
export const ACCOUNT_WATCH_PROJECTS_DRAWN = 50;

export function accountWatchProjectTake(): number {
  return ACCOUNT_WATCH_PROJECTS_DRAWN + 1;
}
