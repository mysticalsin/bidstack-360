import { notePageWording } from './contact-notes';

/** Open opportunities drawn on the account cockpit. One extra loaded row is not shown. */
export const COCKPIT_OPPORTUNITY_PAGE_LIMIT = 5;

/**
 * Opportunity caption. A longer loaded list is the latest rows, not every
 * opportunity. A slice that matches the loaded set keeps the old wording.
 * No opportunity total is invented.
 */
export function recentOpportunityCaption(
  count: number,
  pageContinues: boolean,
  complete: string,
): string {
  return notePageWording(
    pageContinues,
    complete,
    `${count} in the latest ${COCKPIT_OPPORTUNITY_PAGE_LIMIT}, not every opportunity`,
  );
}
