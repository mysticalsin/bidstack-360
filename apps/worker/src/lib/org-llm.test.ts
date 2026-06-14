import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@bidstack/db', () => ({ prisma: { $queryRaw: vi.fn() } }));
vi.mock('@bidstack/shared/server-crypto', () => ({
  decryptSecret: vi.fn(() => JSON.stringify({ apiKey: 'sk-test' })),
}));

import { prisma } from '@bidstack/db';

import { resolveOrgLlm } from './org-llm.js';

const q = vi.mocked(prisma.$queryRaw as unknown as (...args: unknown[]) => Promise<unknown[]>);

describe('resolveOrgLlm', () => {
  beforeEach(() => q.mockReset());

  it('returns null when the org has no active provider selected', async () => {
    q.mockResolvedValueOnce([]); // active selector row absent
    expect(await resolveOrgLlm('org-1')).toBeNull();
    expect(q).toHaveBeenCalledTimes(1); // short-circuits before reading a credential
  });

  it('returns null when the active provider has no stored credential row', async () => {
    q.mockResolvedValueOnce([{ config: { provider: 'openai' }, credentials: {} }]);
    q.mockResolvedValueOnce([]); // credential row missing
    expect(await resolveOrgLlm('org-1')).toBeNull();
  });

  it('resolves the active provider into a runnable client with its decrypted key', async () => {
    q.mockResolvedValueOnce([{ config: { provider: 'openai' }, credentials: {} }]);
    q.mockResolvedValueOnce([
      {
        config: { model: 'gpt-4o', baseUrl: 'https://api.openai.com/v1' },
        credentials: { encrypted: 'cipher' },
      },
    ]);
    expect(await resolveOrgLlm('org-1')).toEqual({
      kind: 'openai',
      apiKey: 'sk-test',
      model: 'gpt-4o',
      baseUrl: 'https://api.openai.com/v1',
    });
  });

  it('resolves keyless local Gemma (no encrypted key needed)', async () => {
    q.mockResolvedValueOnce([{ config: { provider: 'gemma' }, credentials: {} }]);
    q.mockResolvedValueOnce([{ config: {}, credentials: {} }]);
    const llm = await resolveOrgLlm('org-1');
    expect(llm?.kind).toBe('gemma');
    expect(llm?.apiKey).toBe('local');
  });

  it('falls back to null (not a thrown job) when a non-Gemma provider has no key', async () => {
    q.mockResolvedValueOnce([{ config: { provider: 'kimi' }, credentials: {} }]);
    q.mockResolvedValueOnce([{ config: { model: 'moonshot-v1-32k' }, credentials: {} }]);
    expect(await resolveOrgLlm('org-1')).toBeNull();
  });
});
