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

  it('resolves a stream that never ends within 2 seconds', async () => {
    const started = Date.now();
    let pulled = 0;
    await Promise.race([
      discardUpstreamBody({
        body: {
          cancel() {
            return new Promise(() => undefined);
          },
          getReader() {
            return {
              async read() {
                pulled += 1024;
                return { done: false, value: new Uint8Array(1024) };
              },
              cancel() {
                return undefined;
              },
            };
          },
        },
        text() {
          return new Promise(() => '');
        },
      }),
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error('too slow')), 2_500);
      }),
    ]);
    expect(Date.now() - started).toBeLessThan(2_500);
    expect(pulled).toBeLessThanOrEqual(64 * 1024);
  });

  it('does not throw when text() throws', async () => {
    await expect(
      discardUpstreamBody({
        body: null,
        text() {
          throw new Error('provider-body-SENTINEL-upstream-text');
        },
      }),
    ).resolves.toBeUndefined();
  });
});
