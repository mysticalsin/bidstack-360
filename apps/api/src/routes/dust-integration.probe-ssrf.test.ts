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
  const actual = await importOriginal();
  return {
    ...(actual as Record<string, unknown>),
    assertUrlResolvesPublic: (url: string) => resolvePublic(url),
    pinnedFetch: (...args: unknown[]) => pinnedFetchMock(...args),
  };
});

import { isLocalDevelopmentHostname, probeIntegrationEndpoint } from './dust-integration.helpers.js';

/**
 * WHY: Hammer ARTEX F-12. Outside production the probe treats any hostname
 * that starts with "127." as loopback and skips the DNS pin. 127.attacker.example
 * is not loopback. The probe must resolve it.
 */
describe('isLocalDevelopmentHostname', () => {
  it('accepts only localhost, ::1 and the address 127.0.0.1', () => {
    expect(isLocalDevelopmentHostname('127.attacker.example')).toBe(false);
    expect(isLocalDevelopmentHostname('127.0.0.2')).toBe(false);
    expect(isLocalDevelopmentHostname('127.0.0.1')).toBe(true);
    expect(isLocalDevelopmentHostname('[::1]')).toBe(true);
    expect(isLocalDevelopmentHostname('localhost')).toBe(true);
  });
});

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

  it('refuses 127.0.0.2 as a loopback literal instead of probing it', async () => {
    await expect(probeIntegrationEndpoint('mcp', 'https://127.0.0.2/mcp')).rejects.toThrow(/private|localhost|internal/i);
    expect(resolvePublic).not.toHaveBeenCalled();
    expect(pinnedFetchMock).not.toHaveBeenCalled();
  });

  it('still skips the public check for 127.0.0.1 outside production', async () => {
    await probeIntegrationEndpoint('mcp', 'http://127.0.0.1/mcp');
    expect(resolvePublic).not.toHaveBeenCalled();
  });
});
