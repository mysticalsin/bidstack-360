import { describe, expect, it } from 'vitest';

import { downloadCombinedPdf } from './docusign-envelopes.js';
import { downloadDriveItem } from './graph-drive.js';
import { readBodyCapped } from './read-capped.js';

const MB = 1024 * 1024;

/** An endless body with no content-length that records whether it was cancelled. */
function endless(): { res: Response; state: { pulled: number; cancelled: boolean } } {
  const state = { pulled: 0, cancelled: false };
  const body = new ReadableStream<Uint8Array>({
    pull(c) {
      state.pulled += 1;
      c.enqueue(new Uint8Array(MB));
    },
    cancel() {
      state.cancelled = true;
    },
  });
  return { res: new Response(body), state };
}

describe('capped connector downloads', () => {
  it('stops reading and cancels a body without content-length once it passes the cap', async () => {
    const { res, state } = endless();
    expect(await readBodyCapped(res, 3 * MB)).toBeNull();
    expect(state.cancelled).toBe(true);
    expect(state.pulled).toBeLessThan(10);
  });

  it('returns bodies under the cap', async () => {
    expect((await readBodyCapped(new Response(Buffer.from('%PDF-1.7')), MB))?.toString()).toBe('%PDF-1.7');
  });

  it('Graph download rejects an oversized stream without reading it all', async () => {
    const { res, state } = endless();
    await expect(downloadDriveItem(async () => res, 'tok', { driveId: 'd', itemId: 'i', maxBytes: 2 * MB })).rejects.toThrow(/larger than the agreement limit/);
    expect(state.cancelled).toBe(true);
  });

  it('DocuSign download rejects an oversized stream without reading it all', async () => {
    const { res, state } = endless();
    await expect(
      downloadCombinedPdf(async () => res, 'tok', { baseUrl: 'https://demo.docusign.net', accountId: 'a' }, 'env-1', 2 * MB),
    ).rejects.toThrow(/larger than the agreement limit/);
    expect(state.cancelled).toBe(true);
  });
});
