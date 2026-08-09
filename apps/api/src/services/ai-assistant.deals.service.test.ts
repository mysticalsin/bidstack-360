/**
 * ai-assistant.deals.service.test.ts — OmniRoute direct-LLM fallback for
 * deal sentiment + account intel.
 *
 * WHY: when Dust is unconfigured, these two functions used to drop straight
 * to a canned stub. They must now try completeChatOrNull (the OmniRoute
 * fallback) first and only fall through to the stub when that also returns
 * null. These tests assert the OmniRoute completion is what actually reaches
 * the parsed result — if the wiring reverts to "stub first" or drops the
 * fallback call, the assertions on `summary`/`score`/`healthScore` fail.
 */
import type { Logger as PinoLogger } from 'pino';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  checkDailyCap: vi.fn(),
  buildDustClient: vi.fn(),
  resolveAgentId: vi.fn(),
  completeChatOrNull: vi.fn(),
  persistSession: vi.fn(),
  recordCost: vi.fn(),
  buildSentimentContext: vi.fn(),
  buildAccountIntelContext: vi.fn(),
}));

// Dust is deliberately left unconfigured (client: null) for every test here
// — that's the exact condition under which the OmniRoute fallback must run.
vi.mock('./ai-assistant.helpers.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./ai-assistant.helpers.js')>();
  return {
    ...actual, // keep estimateCost real — it's a pure function, no reason to fake it
    checkDailyCap: mocks.checkDailyCap,
    buildDustClient: mocks.buildDustClient,
    resolveAgentId: mocks.resolveAgentId,
    completeChatOrNull: mocks.completeChatOrNull,
    persistSession: mocks.persistSession,
    recordCost: mocks.recordCost,
  };
});

vi.mock('./ai-assistant.context.js', () => ({
  buildSentimentContext: mocks.buildSentimentContext,
  buildAccountIntelContext: mocks.buildAccountIntelContext,
}));

const { analyzeDealSentiment, summarizeAccountIntel } = await import(
  './ai-assistant.deals.service.js'
);

const log = { child: vi.fn(), warn: vi.fn() } as unknown as PinoLogger;
(log.child as ReturnType<typeof vi.fn>).mockReturnValue(log);

const opts = { orgId: 'org-1', userId: 'user-1', dealId: 'deal-1', accountId: 'acct-1' };

beforeEach(() => {
  vi.clearAllMocks();
  (log.child as ReturnType<typeof vi.fn>).mockReturnValue(log);
  mocks.checkDailyCap.mockResolvedValue({ allowed: true });
  mocks.buildDustClient.mockResolvedValue({ client: null, creds: null }); // Dust unconfigured
  mocks.resolveAgentId.mockReturnValue(undefined);
  mocks.persistSession.mockResolvedValue('session-1');
  mocks.recordCost.mockResolvedValue(undefined);
});

describe('analyzeDealSentiment', () => {
  beforeEach(() => {
    mocks.buildSentimentContext.mockResolvedValue({
      opp: { id: opts.dealId, name: 'Acme Renewal', stage: 'negotiation' },
      activitiesSummary: '[call] Check-in: went well',
      activities: [{ type: 'call' }],
    });
  });

  it('uses the OmniRoute completion instead of the stub when Dust is unconfigured', async () => {
    mocks.completeChatOrNull.mockResolvedValue(
      JSON.stringify({
        score: 0.75,
        label: 'positive',
        summary: 'OmniRoute-generated summary',
        riskFlags: [],
        suggestedActions: ['Send proposal'],
      }),
    );

    const result = await analyzeDealSentiment(opts, log);

    // Proves the fallback was actually invoked with the same prompt Dust would've gotten.
    expect(mocks.completeChatOrNull).toHaveBeenCalledWith(
      opts.orgId,
      expect.objectContaining({ responseFormat: 'json_object' }),
      log,
    );
    // If this reverted to "stub first", score/summary would be the heuristic values
    // (0.3 / "1 activities recorded for this deal."), not these OmniRoute values.
    expect(result.score).toBe(0.75);
    expect(result.summary).toBe('OmniRoute-generated summary');
    expect(result.suggestedActions).toEqual(['Send proposal']);
  });

  it('falls through to the static stub when OmniRoute also returns null', async () => {
    mocks.completeChatOrNull.mockResolvedValue(null);

    const result = await analyzeDealSentiment(opts, log);

    expect(mocks.completeChatOrNull).toHaveBeenCalled();
    expect(result.summary).toBe('1 activities recorded for this deal.');
  });
});

describe('summarizeAccountIntel', () => {
  beforeEach(() => {
    mocks.buildAccountIntelContext.mockResolvedValue({
      opps: [{ id: 'o1', name: 'Deal A', stage: 'closed_won', valueMicros: 1_000_000n }],
      contacts: [{ id: 'c1', name: 'Jane', role: 'CTO', aiOptOut: false }],
      oppSummary: '"Deal A" (closed_won, $1)',
      contactSummary: 'Jane (CTO)',
    });
  });

  it('uses the OmniRoute completion instead of the stub when Dust is unconfigured', async () => {
    mocks.completeChatOrNull.mockResolvedValue(
      JSON.stringify({
        healthScore: 88,
        summary: 'OmniRoute account summary',
        expansionOpportunities: ['Upsell tier 2'],
        churnRisks: [],
      }),
    );

    const result = await summarizeAccountIntel(opts, log);

    expect(mocks.completeChatOrNull).toHaveBeenCalledWith(
      opts.orgId,
      expect.objectContaining({ responseFormat: 'json_object' }),
      log,
    );
    // Heuristic stub would compute healthScore 100 (1 won, 0 lost) — 88 only
    // appears if the OmniRoute completion was actually used.
    expect(result.healthScore).toBe(88);
    expect(result.summary).toBe('OmniRoute account summary');
    expect(result.expansionOpportunities).toEqual(['Upsell tier 2']);
  });

  it('falls through to the static stub when OmniRoute also returns null', async () => {
    mocks.completeChatOrNull.mockResolvedValue(null);

    const result = await summarizeAccountIntel(opts, log);

    expect(mocks.completeChatOrNull).toHaveBeenCalled();
    expect(result.healthScore).toBe(100); // 1 won, 0 lost -> (1+1)/(1+0+1)*100
  });
});
