/** Routing rules the list draws. The route reads one past this page. */
export const ROUTING_RULE_LIST_PAGE = 500;

/**
 * Caption on the lead routing list. The route reads one rule past this page
 * and drops it. A continued page is not every routing rule. A shorter page
 * keeps "N total". No routing-rule total is invented.
 */
export function routingRuleListCaption(
  count: number,
  pageContinues: boolean,
  latest: number,
): string {
  if (pageContinues) {
    return `${count} in the latest ${latest}, not every routing rule`;
  }
  return `${count} total`;
}
