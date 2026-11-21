import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.DATABASE_URL ??= 'postgresql://polo:polo@127.0.0.1:5432/polo_test';
  process.env.NODE_ENV = 'test';
});

const { resolvePublic, pinnedFetchMock } = vi.hoisted(() => ({
  resolvePublic: vi.fn(async (url: string) => new URL(url)),
  pinnedFetchMock: vi.fn(async () => ({
    status: 200,
    headers: { get: () => null },
    body: new Uint8Array(),
    text: async () => '',
    url: '',
    pinnedAddress: '93.184.216.34',
    toResponse: () => new Response(null, { status: 200 }),
  })),
}));

vi.mock('@bidstack/shared/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@bidstack/shared/server')>();
  return {
    ...actual,
    assertUrlResolvesPublic: (url: string) => resolvePublic(url),
    pinnedFetch: (...args: unknown[]) => pinnedFetchMock(...args),
  };
});

import { probeIntegrationEndpoint } from './dust-integration.helpers.js';

/**
 * WHY: Hammer ARTEX F-12. Outside production the probe treats any hostname
 * that starts with "127." as loopback and skips the DNS pin. 127.attacker.example
 * is not loopback. The probe must resolve it.
 */
describe('integration probe loopback check', () => {
  beforeEach(() => {
    resolvePublic.mockClear();
    pinnedFetchMock.mockClear();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 200 })));
  });

  it('resolves 127.attacker.example instead of treating it as loopback', async () => {
    await probeIntegrationEndpoint('mcp', 'https://127.attacker.example/mcp');
    expect(resolvePublic).toHaveBeenCalledWith('https://127.attacker.example/mcp');
  });

  it('does not treat the rest of 127.0.0.0/8 as the dev carve-out', async () => {
    await probeIntegrationEndpoint('mcp', 'https://127.0.0.2/mcp');
    expect(resolvePublic).toHaveBeenCalledWith('https://127.0.0.2/mcp');
  });

  it('still skips the public check for 127.0.0.1 outside production', async () => {
    await probeIntegrationEndpoint('mcp', 'http://127.0.0.1/mcp');
    expect(resolvePublic).not.toHaveBeenCalled();
  });
});
