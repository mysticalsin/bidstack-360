import { notePageWording } from './contact-notes';

/** Tasks shown on one opportunity. The list route returns one page, not a total. */
export const OPPORTUNITY_TASK_PAGE_LIMIT = 50;

/**
 * Opportunity task caption. Same rule as `companyNoteTabLabel`: a continuing
 * page is the latest tasks, not every task. A shorter page keeps "N active".
 */
export function opportunityTaskCaption(count: number, pageContinues: boolean): string {
  return notePageWording(
    pageContinues,
    `${count} active`,
    `${count} in the latest ${OPPORTUNITY_TASK_PAGE_LIMIT}, not every task`,
  );
}
