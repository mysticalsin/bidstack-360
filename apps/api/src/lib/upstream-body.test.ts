// WHY: a failed provider response can be huge. Reading it all into the
// process pulls tokens and mailbox text into memory. Cancel the stream.

import { describe, expect, it } from 'vitest';

import { discardUpstreamBody } from './upstream-body.js';

describe('discardUpstreamBody', () => {
  it('cancels the provider stream instead of reading it', async () => {
    let cancelled = false;
    let read = false;
    await discardUpstreamBody({
      body: {
        cancel() {
          cancelled = true;
        },
      },
      async text() {
        read = true;
        return 'x'.repeat(8_000_000);
      },
    });
    expect(cancelled).toBe(true);
    expect(read).toBe(false);
  });
});
