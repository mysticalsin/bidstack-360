/**
 * Drain a failed upstream response and drop the bytes.
 *
 * Provider error bodies can carry tokens, mailbox text, or customer ids.
 * Callers log the status and throw a status-only error. They do not keep
 * the body.
 */
export async function discardUpstreamBody(res: { text(): Promise<string> }): Promise<void> {
  await res.text().catch(() => '');
}
