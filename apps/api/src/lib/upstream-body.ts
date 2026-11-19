/**
 * Stop a failed upstream response without reading it.
 *
 * Provider error bodies can carry tokens, mailbox text, or customer ids.
 * Callers log the status and throw a status-only error. Cancelling the
 * stream drops the bytes. Reading them would pull an unbounded body into
 * the process.
 */
export async function discardUpstreamBody(res: {
  body?: { cancel?: () => void | Promise<void> } | null;
}): Promise<void> {
  const cancel = res.body?.cancel;
  if (typeof cancel !== 'function') return;
  await Promise.resolve(cancel.call(res.body)).catch(() => undefined);
}
