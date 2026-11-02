import { notePageWording } from './contact-notes';

/**
 * Account notes quoted on one opportunity brief.
 * The brief route reads one note past this limit and drops it.
 */
/** Keep equal to `OPPORTUNITY_NOTE_PAGE_LIMIT` in opportunities.brief.ts. */
export const OPPORTUNITY_NOTE_PAGE_LIMIT = 5;

/**
 * Caption for those notes. Same rule as `companyNoteTabLabel`: a continuing
 * page is the latest notes, not every note. A shorter page adds nothing,
 * which is the old brief.
 */
export function opportunityNoteCaption(count: number, pageContinues: boolean): string {
  return notePageWording(
    pageContinues,
    '',
    `${count} in the latest ${OPPORTUNITY_NOTE_PAGE_LIMIT}, not every note`,
  );
}
