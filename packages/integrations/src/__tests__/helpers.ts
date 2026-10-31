import { vi, type Mock } from 'vitest';

import type { IntegrationConfig } from '../types/plugin.js';

export interface RecordedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
}

/** Install a fetch double that records every call and answers from a queue. */
type FetchDouble = Mock<(input: string | URL, init?: RequestInit) => Promise<Response>>;

export function mockFetch(responses: Array<{ status?: number; json?: unknown } | Error>): {
  calls: RecordedCall[];
  fn: FetchDouble;
} {
  const calls: RecordedCall[] = [];
  const queue = [...responses];
  const fn: FetchDouble = vi.fn(async (input: string | URL, init: RequestInit = {}) => {
    const headers: Record<string, string> = {};
    new Headers(init.headers).forEach((v, k) => {
      headers[k] = v;
    });
    calls.push({
      url: String(input),
      method: (init.method ?? 'GET').toUpperCase(),
      headers,
      body: init.body === undefined ? undefined : String(init.body),
    });
    const next = queue.shift() ?? { status: 200, json: {} };
    if (next instanceof Error) throw next;
    return new Response(JSON.stringify(next.json ?? {}), {
      status: next.status ?? 200,
      headers: { 'content-type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fn);
  return { calls, fn };
}

export function makeConfig(overrides: Partial<IntegrationConfig> = {}): IntegrationConfig {
  const now = new Date('2026-10-31T12:00:00Z');
  return {
    id: 'cfg_1',
    orgId: 'org_1',
    provider: 'test',
    displayName: 'Test',
    credentials: {},
    settings: {},
    status: 'disconnected',
    enabled: true,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

export const ctx = (config: IntegrationConfig) => ({ orgId: 'org_1', userId: 'user_1', config });
