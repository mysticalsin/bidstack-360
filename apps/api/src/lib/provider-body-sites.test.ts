// WHY: each converted fetch site has to keep the provider body out of the
// thrown error. One sentinel covers the set, and the Zoom recordings call
// is in the table so putting the body back on that throw goes red.

import { afterEach, describe, expect, it, vi } from 'vitest';

import { generateEmbedding } from './embeddings.js';
import { exchangeHubSpotCode, probeHubSpotConnection, refreshHubSpotToken } from './hubspot-client.js';
import { sendViaGmail } from '../services/email-integration.gmail.js';
import { sendViaMsGraph } from '../services/email-integration.graph.js';
import type { ServiceLogger } from '../services/email-integration.helpers.js';
import { getZoomRecordings } from '../services/calls/zoom.service.js';
import { transcribeAudioUrl } from '../services/calls/transcription.service.js';

const SENTINEL = 'provider-body-SENTINEL-upstream-text';

function badResponse() {
  return new Response(SENTINEL, { status: 401, statusText: 'Unauthorized' });
}

function logCapture(): { log: ServiceLogger; lines: string[] } {
  const lines: string[] = [];
  const write = (obj: unknown, msg?: string) => {
    lines.push(JSON.stringify({ obj, msg }));
  };
  return {
    lines,
    log: { debug: write, error: write, info: write, warn: write },
  };
}

const mail = {
  orgId: 'org',
  userId: 'user',
  to: [{ email: 'buyer@example.com' }],
  subject: 'Hello',
  text: 'Hi',
};

describe('converted provider error bodies', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete process.env.COHERE_API_KEY;
    delete process.env.DEEPGRAM_API_KEY;
    delete process.env.ZOOM_ACCOUNT_ID;
    delete process.env.ZOOM_CLIENT_ID;
    delete process.env.ZOOM_CLIENT_SECRET;
  });

  const cases: Array<{ name: string; run: (log: ServiceLogger) => Promise<unknown> }> = [
    {
      name: 'exchangeHubSpotCode',
      run: () => exchangeHubSpotCode('code', 'client', 'secret', 'https://example.com/callback'),
    },
    {
      name: 'refreshHubSpotToken',
      run: () => refreshHubSpotToken('refresh', 'client', 'secret'),
    },
    {
      name: 'probeHubSpotConnection',
      run: () => probeHubSpotConnection('access-token'),
    },
    {
      name: 'sendViaGmail',
      run: (log) =>
        sendViaGmail('access-token', mail, 'pixel', log),
    },
    {
      name: 'sendViaMsGraph',
      run: (log) => sendViaMsGraph('access-token', mail, 'pixel', log),
    },
    {
      name: 'generateEmbedding',
      run: () => {
        process.env.COHERE_API_KEY = 'cohere-test-key';
        return generateEmbedding('hello');
      },
    },
    {
      name: 'transcribeAudioUrl',
      run: () => {
        process.env.DEEPGRAM_API_KEY = 'deepgram-test-key';
        return transcribeAudioUrl('https://example.com/audio.wav');
      },
    },
  ];

  it.each(cases)('$name does not throw or log the provider body', async ({ run }) => {
    vi.stubGlobal('fetch', vi.fn(async () => badResponse()));
    const { log, lines } = logCapture();
    await expect(run(log)).rejects.toThrow(/401|failed/i);
    const thrown = await run(log).catch((err: unknown) => err);
    expect(String(thrown)).not.toContain(SENTINEL);
    expect(lines.join('\n')).not.toContain(SENTINEL);
  });

  it('getZoomRecordings does not throw the provider body', async () => {
    process.env.ZOOM_ACCOUNT_ID = 'zoom-account';
    process.env.ZOOM_CLIENT_ID = 'zoom-client';
    process.env.ZOOM_CLIENT_SECRET = 'zoom-secret';
    let calls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        calls += 1;
        if (calls === 1) {
          return Response.json({ access_token: 'zoom-access', expires_in: 3600 });
        }
        return badResponse();
      }),
    );
    await expect(getZoomRecordings('meeting-1')).rejects.toThrow(/getRecordings failed \(401\)/);
    try {
      await getZoomRecordings('meeting-1');
    } catch (err) {
      expect(String(err)).not.toContain(SENTINEL);
    }
  });
});
