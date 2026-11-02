import { ACCOUNT_ACTIVITY_PAGE_LIMIT } from '@bidstack/shared';

import { notePageWording } from './contact-notes';

/**
 * Account activity caption. Same rule as `companyNoteTabLabel`: a continuing
 * page is the latest activities, not every activity. A shorter page keeps
 * "Last N items".
 */
export function accountActivityCaption(count: number, pageContinues: boolean): string {
  const complete = count === 1 ? 'Last 1 item' : `Last ${count} items`;
  return notePageWording(
    pageContinues,
    complete,
    `${count} in the latest ${ACCOUNT_ACTIVITY_PAGE_LIMIT}, not every activity`,
  );
}
