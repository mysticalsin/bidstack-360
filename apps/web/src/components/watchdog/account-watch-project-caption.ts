/** Closed projects the account track record draws. One loaded row past this is not shown. */
export const ACCOUNT_WATCH_PROJECTS_DRAWN = 50;

/**
 * Track-record summary. A longer loaded list is the latest closed bids, not
 * every project. A list that fits keeps "N won, M lost". No project total
 * is invented.
 */
export function accountWatchProjectSummary(
  won: number,
  lost: number,
  pageContinues: boolean,
): string {
  if (pageContinues) {
    return `${ACCOUNT_WATCH_PROJECTS_DRAWN} in the latest ${ACCOUNT_WATCH_PROJECTS_DRAWN}, not every project`;
  }
  return `${won} won, ${lost} lost`;
}

/**
 * Expand control. A longer loaded list is not a total, so the button does
 * not print that length. A list that fits keeps "Show N projects".
 */
export function accountWatchProjectToggle(count: number, open: boolean, pageContinues: boolean): string {
  if (open) return 'Hide projects';
  if (pageContinues) return 'Show these projects';
  return `Show ${count} projects`;
}
