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

  // WHY: baseUrl is org-admin-controlled and the DNS-rebind-safe wrapper
  // (createSafeFetch in @bidstack/shared/server) lives app-side — it can only
  // guard traffic that flows through the injected fetch. A single request that
  // falls back to the ambient global fetch silently reopens the SSRF hole.
  it('routes every request through the injected fetch, never the ambient global', async () => {
    const globalFetchSpy = vi.fn();
    vi.stubGlobal('fetch', globalFetchSpy);
    const injected = vi.fn(
      async () =>
        new Response(JSON.stringify({ agentConfigurations: [], document: { document_id: 'doc-1', data_source_id: 'ds-1' } }), {
          status: 200,
        }),
    );

    const dust = new DustClient({
      apiKey: 'sk_test',
      workspaceId: 'workspace-1',
      baseUrl: 'https://dust.example/api',
      timeoutMs: 1000,
      logger,
      fetchImpl: injected,
    });

    await dust.listAgents();
    await dust.upsertDocument('ds-1', 'doc-1', 'body');

    expect(injected).toHaveBeenCalledTimes(2);
    expect(globalFetchSpy).not.toHaveBeenCalled();
  });

  // WHY: fetch's default redirect:'follow' would replay the Authorization
  // bearer to an arbitrary Location target that the SSRF DNS gate never
  // validated (and createSafeFetch hard-rejects 'follow'). The client must
  // send redirect:'manual' and treat any 3xx as an error, not follow it.
  it("sends redirect:'manual' and refuses redirect responses", async () => {
    const injected = vi.fn(
      async () =>
        new Response(null, {
          status: 302,
          headers: { Location: 'http://169.254.169.254/latest/meta-data/' },
        }),
    );

    const dust = new DustClient({
      apiKey: 'sk_test',
      workspaceId: 'workspace-1',
      baseUrl: 'https://dust.example/api',
      timeoutMs: 1000,
      logger,
      fetchImpl: injected,
    });

    await expect(dust.listAgents()).rejects.toMatchObject({
      name: 'DustError',
      status: 302,
    });
    expect(injected).toHaveBeenCalledTimes(1);
    const [, init] = injected.mock.calls[0] as [string, RequestInit];
    expect(init.redirect).toBe('manual');
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
