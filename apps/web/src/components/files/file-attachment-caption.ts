import { FILE_ATTACHMENTS_DRAWN, fileAttachmentPage } from '@bidstack/shared';

export { FILE_ATTACHMENTS_DRAWN, fileAttachmentPage };

/**
 * Attachments the files list draws. The API drops the probe and sets
 * `itemsContinue`. A response that still carries that row is paged here
 * so the probe is not shown.
 */
export function shownFileAttachments<T>(
  items: readonly T[],
  itemsContinue: boolean | undefined,
): { items: T[]; pageContinues: boolean } {
  if (items.length > FILE_ATTACHMENTS_DRAWN) return fileAttachmentPage(items);
  return { items: [...items], pageContinues: Boolean(itemsContinue) };
}

/**
 * Account files caption. A longer loaded list is the latest attachments,
 * not every attachment. A shorter list keeps "N attachment(s)".
 * No attachment total is invented.
 */
export function fileAttachmentCaption(count: number, pageContinues: boolean): string {
  if (pageContinues) {
    return `${count} in the latest ${count}, not every attachment`;
  }
  return `${count} attachment(s) - access follows account groups`;
}
