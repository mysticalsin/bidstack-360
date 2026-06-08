import { afterEach, describe, expect, it, vi } from 'vitest';
import pino from 'pino';

import { DustClient, DustError } from './index.js';

const logger = pino({ level: 'silent' });

describe('DustClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('lists workspace agents through the official agent-configurations endpoint', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            agentConfigurations: [
              { sId: 'agent-sales', name: 'Sales Research', description: 'Account research' },
              { id: 'agent-bid', description: 'Bid assistant' },
            ],
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const dust = new DustClient({
      apiKey: 'sk_test',
      workspaceId: 'workspace-1',
      baseUrl: 'https://dust.example/api',
      timeoutMs: 1000,
      logger,
    });

    await expect(dust.listAgents()).resolves.toEqual([
      { id: 'agent-sales', label: 'Sales Research', description: 'Account research' },
      { id: 'agent-bid', label: 'Bid assistant', description: 'Bid assistant' },
    ]);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://dust.example/api/v1/w/workspace-1/assistant/agent_configurations?view=list',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer sk_test' }),
      }),
    );
  });

  it('raises a typed DustError on non-success responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 })),
    );

    const dust = new DustClient({
      apiKey: 'bad',
      workspaceId: 'workspace-1',
      baseUrl: 'https://dust.example/api',
      timeoutMs: 1000,
      logger,
    });

    await expect(dust.listAgents()).rejects.toBeInstanceOf(DustError);
  });

  it('passes cancellation signals to Dust agent runs', async () => {
    const ctl = new AbortController();
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ run_id: 'run-1', status: 'succeeded', output: 'ok' }),
          { status: 200 },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const dust = new DustClient({
      apiKey: 'sk_test',
      workspaceId: 'workspace-1',
      baseUrl: 'https://dust.example/api',
      timeoutMs: 1000,
      logger,
    });

    await expect(dust.runAgent('agent-1', 'hello', { signal: ctl.signal })).resolves.toMatchObject({
      run_id: 'run-1',
      status: 'succeeded',
    });

    const [, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(opts.signal).toBeInstanceOf(AbortSignal);
  });
});
