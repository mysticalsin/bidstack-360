/** Templates the list draws. The route reads one past this page. */
export const EMAIL_TEMPLATE_LIST_PAGE = 200;

/**
 * Count on the email-template list. The route reads one template past this
 * page and drops it. A continued page is not every template. A shorter page
 * keeps the bare count. No template total is invented.
 */
export function emailTemplateListCaption(
  count: number,
  pageContinues: boolean,
  latest = EMAIL_TEMPLATE_LIST_PAGE,
): string {
  if (pageContinues) return `${count} in the latest ${latest}, not every template`;
  return String(count);
}
