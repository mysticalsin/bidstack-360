import { COMPANY_NOTE_PAGE_LIMIT } from '@bidstack/shared';

import { notePageWording } from './contact-notes';

/**
 * Company detail tab label. Same rule as `contactNoteCaption`: a continuing
 * page is the latest notes, not every note. A shorter page keeps "Notes (N)".
 */
export function companyNoteTabLabel(count: number, pageContinues: boolean): string {
  return notePageWording(
    pageContinues,
    `Notes (${count})`,
    `Notes (${count} in the latest ${COMPANY_NOTE_PAGE_LIMIT}, not every note)`,
  );
}
