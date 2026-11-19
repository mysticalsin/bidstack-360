// WHY: an upstream 401 body can contain a token, a mailbox snippet, or a
// customer id. That text may be logged, and it must not become the HTTP error.

import { afterEach, describe, expect, it, vi } from 'vitest';

import { exchangeHubSpotCode } from './hubspot-client.js';
import { sendViaGmail } from '../services/email-integration.gmail.js';
import type { ServiceLogger } from '../services/email-integration.helpers.js';

const SENTINEL = 'provider-body-SENTINEL-upstream-text';

function capturingLog(): { log: ServiceLogger; lines: string[] } {
  const lines: string[] = [];
  const write = (obj: unknown, msg?: string) => {
    lines.push(JSON.stringify({ obj, msg }));
  };
  const log: ServiceLogger = {
    debug: write,
    error: write,
    info: write,
    warn: write,
  };
  return { log, lines };
}

describe('upstream provider bodies', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('does not log the Gmail response body when send fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(SENTINEL, { status: 401, statusText: 'Unauthorized' })),
    );
    const { log, lines } = capturingLog();
    await expect(
      sendViaGmail(
        'access-token',
        {
          orgId: 'org',
          userId: 'user',
          to: [{ email: 'buyer@example.com' }],
          subject: 'Hello',
          text: 'Hi',
        },
        'pixel',
        log,
      ),
    ).rejects.toThrow(/Gmail send failed: 401/);

    const logged = lines.join('\n');
    expect(logged).not.toContain(SENTINEL);
    expect(logged).toContain('401');
  });

  it('does not put the HubSpot response body on the thrown error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(SENTINEL, { status: 400, statusText: 'Bad Request' })),
    );
    await expect(
      exchangeHubSpotCode('code', 'client', 'secret', 'https://example.com/callback'),
    ).rejects.toThrow(/HubSpot token exchange failed \(400\)/);
    try {
      await exchangeHubSpotCode('code', 'client', 'secret', 'https://example.com/callback');
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).not.toContain(SENTINEL);
    }
  });
});
