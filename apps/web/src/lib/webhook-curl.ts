import { maskWebhookSignature, redactWebhookText } from '@bidstack/shared';

/** POSIX single-quote: close, escaped quote, reopen. */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * A cURL command that re-sends a stored webhook request. Every HMAC in a
 * signature header is masked and secret-looking body values are redacted, so a
 * copied command never carries a credential; the receiver will reject the
 * masked signature until the operator re-signs it.
 */
export function buildWebhookCurl(input: {
  url: string;
  headers: Record<string, string>;
  body: string;
}): string {
  const lines = [`curl -X POST ${shellQuote(input.url)}`];
  for (const [name, raw] of Object.entries(input.headers)) {
    const value = /signature/i.test(name) ? maskWebhookSignature(raw) : redactWebhookText(raw);
    lines.push(`  -H ${shellQuote(`${name}: ${value}`)}`);
  }
  lines.push(`  --data-raw ${shellQuote(redactWebhookText(input.body))}`);
  return lines.join(' \\\n');
}
