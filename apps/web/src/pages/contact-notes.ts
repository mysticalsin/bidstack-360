/** Notes shown for a contact. The list route returns one page, not a total. */
export const CONTACT_NOTE_PAGE_LIMIT = 100;

/**
 * One rule for a note page. `pageContinues` means the route read one note past
 * this page. A shorter page keeps the caller's old wording.
 */
export function notePageWording(pageContinues: boolean, complete: string, partial: string): string {
  if (pageContinues) return partial;
  return complete;
}

/**
 * Note caption. `pageContinues` means the route read one note past this page,
 * so the related rows are not every account note. A shorter page keeps the
 * old count.
 */
export function contactNoteCaption(count: number, pageContinues: boolean): string {
  return notePageWording(
    pageContinues,
    `${count} related`,
    `${count} related in the latest ${CONTACT_NOTE_PAGE_LIMIT} notes, not every note`,
  );
}
