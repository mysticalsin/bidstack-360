/**
 * ai-assistant.deals.service.test.ts — OmniRoute direct-LLM fallback for
 * deal sentiment + account intel, and the honest stub when that fallback is empty.
 *
 * WHY: when Dust is unconfigured, these two functions try completeChatOrNull
 * first. A missing model result must not invent a sentiment or a health score
 * from activity counts. These tests fail if the wiring drops the OmniRoute
 * call, or if the empty path starts scoring a count as a feeling.
 */
import type { Logger as PinoLogger } from 'pino';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  parseAccountHealthScore,
  parseDealSentimentLabel,
  parseDealSentimentScore,
  recordedAccountIntel,
  recordedDealSentiment,
} from './ai-assistant.deals.service.js';

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
    ...actual,
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
  countRecordedDealOutcomes: () => ({ won: 1, lost: 0 }),
  formatDealForPrompt: () => '',
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
  mocks.buildDustClient.mockResolvedValue({ client: null, creds: null });
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

    expect(mocks.completeChatOrNull).toHaveBeenCalledWith(
      opts.orgId,
      expect.objectContaining({ responseFormat: 'json_object' }),
      log,
    );
    expect(result.score).toBe(0.75);
    expect(result.summary).toBe('OmniRoute-generated summary');
    expect(result.suggestedActions).toEqual(['Send proposal']);
  });

  it('records the activity count without a score when OmniRoute also returns null', async () => {
    mocks.completeChatOrNull.mockResolvedValue(null);

    const result = await analyzeDealSentiment(opts, log);

    expect(mocks.completeChatOrNull).toHaveBeenCalled();
    expect(result.summary).toContain('1 activities recorded');
    expect(result.score).toBeNull();
    expect(result.label).toBeNull();
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
    expect(result.healthScore).toBe(88);
    expect(result.summary).toBe('OmniRoute account summary');
    expect(result.expansionOpportunities).toEqual(['Upsell tier 2']);
  });

  it('does not invent a health score when OmniRoute also returns null', async () => {
    mocks.completeChatOrNull.mockResolvedValue(null);

    const result = await summarizeAccountIntel(opts, log);

    expect(mocks.completeChatOrNull).toHaveBeenCalled();
    expect(result.healthScore).toBeNull();
    expect(result.expansionOpportunities).toEqual([]);
    expect(result.summary).toContain('No health score was produced');
  });
});

describe('recorded deal sentiment', () => {
  it('does not turn an activity count into a sentiment score', () => {
    const none = recordedDealSentiment(0);
    const many = recordedDealSentiment(5);
    expect(none.score).toBeNull();
    expect(none.label).toBeNull();
    expect(none.riskFlags).toEqual([]);
    expect(none.suggestedActions).toEqual([]);
    expect(none.summary).toContain('0 activities recorded');
    expect(many.summary).toContain('5 activities recorded');
    expect(many.score).toBeNull();
  });

  it('keeps a model score only inside -1 to 1 and a known label', () => {
    expect(parseDealSentimentScore(-0.2)).toBe(-0.2);
    expect(parseDealSentimentScore(2)).toBeNull();
    expect(parseDealSentimentScore(undefined)).toBeNull();
    expect(parseDealSentimentLabel('neutral')).toBe('neutral');
    expect(parseDealSentimentLabel('unknown')).toBeNull();
  });
});

describe('recorded account intel', () => {
  it('does not invent a health score or a play from deal counts', () => {
    const intel = recordedAccountIntel({
      opportunityCount: 7,
      wonCount: 4,
      lostCount: 2,
      contactCount: 3,
    });
    expect(intel.healthScore).toBeNull();
    expect(intel.expansionOpportunities).toEqual([]);
    expect(intel.churnRisks).toEqual([]);
    expect(intel.summary).toContain('4 won');
    expect(intel.summary).toContain('2 lost');
    expect(intel.summary).toContain('No health score was produced');
  });

  it('keeps only a finite score from 0 to 100', () => {
    expect(parseAccountHealthScore(71.2)).toBe(71);
    expect(parseAccountHealthScore(0)).toBe(0);
    expect(parseAccountHealthScore(undefined)).toBeNull();
    expect(parseAccountHealthScore(50.5)).toBe(51);
    expect(parseAccountHealthScore(Number.NaN)).toBeNull();
    expect(parseAccountHealthScore(120)).toBeNull();
  });
});
