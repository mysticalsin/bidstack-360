/** Queue heartbeat rows the SERUM status list draws. The query reads one past this page. */
export const QUEUE_HEARTBEAT_PAGE = 10;

/**
 * Sentence on the queue-heartbeat list. The status read loads one queue
 * past this page and drops it. A continued page is not every queue. A
 * shorter page keeps the old "returned" sentence. No queue total is invented.
 */
export function queueHeartbeatDetail(
  count: number,
  pageContinues: boolean,
  latest = QUEUE_HEARTBEAT_PAGE,
): string {
  if (pageContinues) return `${count} in the latest ${latest}, not every queue.`;
  if (count === 1) return '1 queue heartbeat row returned.';
  return `${count} queue heartbeat rows returned.`;
}
