import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ProviderTimeoutError,
  fetchWithTimeout,
  isProviderTimeoutError,
  providerTimeoutMs,
} from './fetch-timeout.js';

const OLD_ENV = { ...process.env };

beforeEach(() => {
  vi.restoreAllMocks();
  process.env = { ...OLD_ENV };
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  process.env = OLD_ENV;
});

describe('fetchWithTimeout', () => {
  it('passes through successful provider responses', async () => {
    const response = new Response('ok', { status: 202 });
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(response);

    await expect(
      fetchWithTimeout('https://provider.example/test', {
        provider: 'TestProvider',
        operation: 'probe',
        timeoutMs: 50,
      }),
    ).resolves.toBe(response);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://provider.example/test',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('aborts hung provider requests with a typed 504 error', async () => {
    vi.useFakeTimers();
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const err = new Error('aborted');
            err.name = 'AbortError';
            reject(err);
          });
        }),
    );

    const promise = fetchWithTimeout('https://provider.example/hang', {
      provider: 'Gmail',
      operation: 'messages.send',
      timeoutMs: 25,
    });

    const assertion = expect(promise).rejects.toMatchObject({
      name: 'ProviderTimeoutError',
      code: 'PROVIDER_HTTP_TIMEOUT',
      statusCode: 504,
      provider: 'Gmail',
      operation: 'messages.send',
      timeoutMs: 25,
    });

    await vi.advanceTimersByTimeAsync(25);
    await assertion;
  });

  it('keeps the deadline armed through body consumption and aborts a stalled body read', async () => {
    vi.useFakeTimers();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      const response = new Response(null, { status: 200 });
      const hang = () =>
        new Promise<never>((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => {
              const err = new Error('aborted');
              err.name = 'AbortError';
              reject(err);
            },
            { once: true },
          );
        });
      return Object.assign(response, { json: hang, text: hang, arrayBuffer: hang });
    });

    const response = await fetchWithTimeout('https://provider.example/slow-body', {
      provider: 'Gmail',
      operation: 'messages.get',
      timeoutMs: 25,
    });

    const assertion = expect(response.json()).rejects.toMatchObject({
      name: 'ProviderTimeoutError',
      code: 'PROVIDER_HTTP_TIMEOUT',
      statusCode: 504,
      provider: 'Gmail',
      operation: 'messages.get',
      timeoutMs: 25,
    });

    await vi.advanceTimersByTimeAsync(25);
    await assertion;
  });

  it('parses positive timeout env values and falls back on unsafe values', () => {
    process.env.TEST_PROVIDER_TIMEOUT_MS = '2500';
    expect(providerTimeoutMs('TEST_PROVIDER_TIMEOUT_MS', 1000)).toBe(2500);

    process.env.TEST_PROVIDER_TIMEOUT_MS = '-1';
    expect(providerTimeoutMs('TEST_PROVIDER_TIMEOUT_MS', 1000)).toBe(1000);
  });

  it('recognizes serialized provider timeout errors', () => {
    expect(isProviderTimeoutError(new ProviderTimeoutError('Slack', 'chat.postMessage', 10))).toBe(
      true,
    );
    expect(isProviderTimeoutError({ code: 'PROVIDER_HTTP_TIMEOUT' })).toBe(true);
    expect(isProviderTimeoutError(new Error('other'))).toBe(false);
  });
});
