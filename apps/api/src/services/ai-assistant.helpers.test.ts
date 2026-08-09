/**
 * ai-assistant.helpers.test.ts — direct-LLM fallback (resolveActiveLlm /
 * completeChatOrNull).
 *
 * WHY these tests matter: the copilot AI features (email draft, deal
 * sentiment, account intel, meeting prep, contact enrich) fall back to a
 * static stub whenever Dust is unconfigured. These two exports are what
 * turns that fallback into a real (free, keyless) LLM call via OmniRoute
 * before the stub. If resolveActiveLlm stops reading RFP_LLM_PROVIDER, or
 * completeChatOrNull starts throwing instead of degrading, every copilot
 * feature silently reverts to the canned stub in production — these tests
 * fail the moment that regresses.
 */
import type { Logger as PinoLogger } from 'pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getOrgActiveAgentProvider: vi.fn(),
  resolveOrgAgentProviderCredential: vi.fn(),
  credentialToResolvedLlm: vi.fn(),
}));

// Mocked so these tests never touch Prisma — org-provider precedence is
// exercised by returning null (no org provider configured), which is the
// exact condition under which the ENV/OmniRoute fallback must kick in.
vi.mock('../lib/agent-provider-credentials.js', () => ({
  getOrgActiveAgentProvider: mocks.getOrgActiveAgentProvider,
  resolveOrgAgentProviderCredential: mocks.resolveOrgAgentProviderCredential,
  credentialToResolvedLlm: mocks.credentialToResolvedLlm,
}));

// ai-assistant.helpers.ts also imports prisma + redis at module scope for
// unrelated exports (checkDailyCap, persistSession) — stub both so import
// never opens a real connection in the unit-test process.
vi.mock('@bidstack/db', () => ({
  prisma: {
    orgSettings: { findUnique: vi.fn() },
    aiAssistantSession: { create: vi.fn() },
    $queryRaw: vi.fn(),
  },
}));
vi.mock('../redis.js', () => ({
  redis: { mget: vi.fn(), pipeline: vi.fn() },
}));

const { completeChatOrNull, resolveActiveLlm } = await import('./ai-assistant.helpers.js');

const orgId = '11111111-1111-4111-8111-111111111111';
const log = { warn: vi.fn() } as unknown as PinoLogger;
const OLD_ENV = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  process.env = { ...OLD_ENV };
  delete process.env.RFP_LLM_PROVIDER;
  delete process.env.OMNIROUTE_BASE_URL;
  delete process.env.OMNIROUTE_MODEL;
  mocks.getOrgActiveAgentProvider.mockResolvedValue(null);
});

afterEach(() => {
  process.env = { ...OLD_ENV };
});

describe('resolveActiveLlm', () => {
  it('falls back to the keyless OmniRoute gateway when no org provider is configured', async () => {
    process.env.RFP_LLM_PROVIDER = 'omniroute';

    const llm = await resolveActiveLlm(orgId);

    expect(mocks.getOrgActiveAgentProvider).toHaveBeenCalledWith(orgId);
    expect(llm).not.toBeNull();
    expect(llm?.kind).toBe('openai'); // OmniRoute speaks the OpenAI-compatible wire shape
    expect(llm?.baseUrl).toBe('http://localhost:20128/v1');
    expect(llm?.model).toBe('auto');
    expect(llm?.extraBody).toEqual({ stream: false }); // forces non-streaming JSON body
  });

  it('prefers the org active provider over the env fallback when both resolve', async () => {
    process.env.RFP_LLM_PROVIDER = 'omniroute';
    mocks.getOrgActiveAgentProvider.mockResolvedValue('claude');
    mocks.resolveOrgAgentProviderCredential.mockResolvedValue({
      provider: 'claude',
      apiKey: 'org-key',
      updatedAt: new Date(),
      source: 'org',
    });
    mocks.credentialToResolvedLlm.mockReturnValue({
      kind: 'anthropic',
      apiKey: 'org-key',
      model: 'claude-sonnet-4-5',
      baseUrl: 'https://api.anthropic.com',
    });

    const llm = await resolveActiveLlm(orgId);

    expect(llm?.kind).toBe('anthropic');
    expect(llm?.apiKey).toBe('org-key');
  });

  it('returns null when neither an org provider nor a recognised env provider is configured', async () => {
    const llm = await resolveActiveLlm(orgId);
    expect(llm).toBeNull();
  });
});

describe('completeChatOrNull', () => {
  it('returns null (never throws) when the resolved LLM call fails, so callers still have their stub', async () => {
    process.env.RFP_LLM_PROVIDER = 'omniroute';
    // Simulate the OmniRoute gateway being unreachable.
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));

    const result = await completeChatOrNull(orgId, { user: 'draft a follow-up email' }, log);

    expect(result).toBeNull();
    expect(log.warn).toHaveBeenCalledTimes(1);
    // Never logs the api key — only provider/model identifiers land in the
    // warn payload (OmniRoute's apiKey is the literal string 'omniroute',
    // so asserting its absence from the logged keys is a real check, not
    // a vacuous one).
    const [meta] = (log.warn as ReturnType<typeof vi.fn>).mock.calls[0] as [Record<string, unknown>];
    expect(Object.keys(meta)).not.toContain('apiKey');
    expect(meta).toMatchObject({ provider: 'openai', model: 'auto' });

    vi.unstubAllGlobals();
  });

  it('returns null without calling the network when no LLM resolves at all', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const result = await completeChatOrNull(orgId, { user: 'draft a follow-up email' }, log);

    expect(result).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(log.warn).not.toHaveBeenCalled(); // nothing to fail — no throw path hit

    vi.unstubAllGlobals();
  });
});
