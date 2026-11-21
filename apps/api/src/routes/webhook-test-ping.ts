// One pinned POST for the webhook test ping. Redirects are refused. The socket
// dials the address the resolver returned, so a second lookup cannot move the
// connection onto a metadata or private address.

import { pinnedFetch, type PinnedResolver, type PinnedTransport } from '@bidstack/shared/server';

export interface WebhookTestPingOptions {
  resolve?: PinnedResolver;
  transport?: PinnedTransport;
  timeoutMs?: number;
}

export async function deliverWebhookTestPing(
  url: string,
  body: string,
  signature: string,
  opts: WebhookTestPingOptions = {},
): Promise<{ status: number }> {
  const res = await pinnedFetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Polo-Signature': signature,
      'X-BidStack-Signature': signature,
      'User-Agent': 'PoloPreSales-Webhooks/1.0',
    },
    body,
    redirect: 'error',
    maxHops: 0,
    timeoutMs: opts.timeoutMs ?? 10_000,
    maxBytes: 64 * 1024,
    resolve: opts.resolve,
    transport: opts.transport,
  });
  return { status: res.status };
}
