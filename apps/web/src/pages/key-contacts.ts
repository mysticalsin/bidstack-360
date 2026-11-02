import { KEY_CONTACT_PAGE_LIMIT } from '@bidstack/shared';

import { notePageWording } from './contact-notes';

const COMPLETE = 'Up to 5 people linked to this account, highest recorded influence first.';

/**
 * Key-contact caption. Same rule as `companyNoteTabLabel`: a continuing page
 * is the latest contacts, not every linked contact. A page that matches the
 * account total keeps the old wording.
 */
export function keyContactCaption(count: number, pageContinues: boolean): string {
  return notePageWording(
    pageContinues,
    COMPLETE,
    `${count} in the latest ${KEY_CONTACT_PAGE_LIMIT}, not every contact`,
  );
}
