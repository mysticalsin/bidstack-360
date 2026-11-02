/** Provider heartbeat rows the SERUM status list draws. The query reads one past this page. */
export const PROVIDER_HEARTBEAT_PAGE = 8;

/**
 * Sentence on the provider-heartbeat list. The status read loads one provider
 * past this page and drops it. A continued page is not every provider. A
 * shorter page keeps the old "returned" sentence. No provider total is invented.
 */
export function providerHeartbeatDetail(
  count: number,
  pageContinues: boolean,
  latest = PROVIDER_HEARTBEAT_PAGE,
): string {
  if (pageContinues) return `${count} in the latest ${latest}, not every provider.`;
  if (count === 1) return '1 provider heartbeat row returned.';
  return `${count} provider heartbeat rows returned.`;
}
