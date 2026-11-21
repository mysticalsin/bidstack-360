import { describe, expect, it } from 'vitest';

import { deliverWebhookTestPing } from './webhook-test-ping.js';

/**
 * WHY: Hammer ARTEX F-09. The test ping resolved the webhook host, rejected a
 * private answer, then called fetch, which looked the name up again. A resolver
 * that flips to 169.254.169.254 between those two lookups must not be dialed.
 */
describe('deliverWebhookTestPing', () => {
  it('dials the first public address and does not open a second lookup', async () => {
    let n = 0;
    const dials: string[] = [];
    const res = await deliverWebhookTestPing('https://rebind.example/hook', '{}', 't=1,v1=abc', {
      resolve: async () => {
        n += 1;
        return [{ address: n === 1 ? '93.184.216.34' : '169.254.169.254', family: 4 as const }];
      },
      transport: async (dial) => {
        dials.push(dial.address);
        return { status: 204, headers: {}, body: new Uint8Array() };
      },
    });
    expect(res.status).toBe(204);
    expect(n).toBe(1);
    expect(dials).toEqual(['93.184.216.34']);
  });

  it('does not dial when the first answer is the metadata address', async () => {
    const transport = async () => {
      throw new Error('dialed');
    };
    await expect(
      deliverWebhookTestPing('https://rebind.example/hook', '{}', 't=1,v1=abc', {
        resolve: async () => [{ address: '169.254.169.254', family: 4 }],
        transport,
      }),
    ).rejects.toThrow(/blocked address/i);
  });
});
