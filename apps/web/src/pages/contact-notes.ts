/** Notes shown for a contact. The list route returns one page, not a total. */
export const CONTACT_NOTE_PAGE_LIMIT = 100;

/**
 * Note caption. `pageContinues` means the route read one note past this page,
 * so the related rows are not every account note. A shorter page keeps the
 * old count.
 */
export function contactNoteCaption(count: number, pageContinues: boolean): string {
  if (pageContinues) {
    return `${count} related in the latest ${CONTACT_NOTE_PAGE_LIMIT} notes, not every note`;
  }
  return `${count} related`;
}
