import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock only completeChat; keep the real coerceJsonObject so fenced/prose JSON
// is exercised end-to-end.
vi.mock('./llm-provider.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, completeChat: vi.fn() };
});

import { extractContractFieldsLLM } from './contract-extract-llm.js';
import { completeChat, type ResolvedLlm } from './llm-provider.js';

const mockComplete = vi.mocked(completeChat);
const LLM: ResolvedLlm = {
  kind: 'moonshot',
  apiKey: 'k',
  model: 'kimi-x',
  baseUrl: 'https://api.moonshot.ai/v1',
};

beforeEach(() => vi.clearAllMocks());

describe('extractContractFieldsLLM', () => {
  it('normalises LLM-friendly shapes into the strict wire types', async () => {
    mockComplete.mockResolvedValue(
      JSON.stringify({
        reference: 'MSA-2026-001',
        kind: 'MSA', // upper-case → lowercased
        countries: ['fr', 'de', 'France'], // "France" must be dropped, not truncated
        currency: 'eur',
        globalRebatePercent: 7.5, // 7.5% → 750 bps
        effectiveDate: '2026-01-01',
        expiryDate: '2027-01-01',
        rateReviewSchedule: 'Annual',
        rateCard: [
          { role: 'Senior Consultant', rate: 850, unit: 'day', currency: 'eur' },
          { role: 'zero', rate: 0, unit: 'day' }, // non-positive → dropped
        ],
      }),
    );

    const draft = await extractContractFieldsLLM('some MSA text', LLM);
    expect(draft).not.toBeNull();
    expect(draft!.reference).toBe('MSA-2026-001');
    expect(draft!.kind).toBe('msa');
    expect(draft!.countries).toEqual(['FR', 'DE']);
    expect(draft!.currency).toBe('EUR');
    expect(draft!.globalRebateBps).toBe(750);
    expect(draft!.effectiveDate).toBe(new Date('2026-01-01').toISOString());
    expect(draft!.rateReviewSchedule).toBe('annual');
    expect(draft!.rateCard).toEqual([
      { role: 'Senior Consultant', rateMicros: 850_000_000, unit: 'day', currency: 'EUR' },
    ]);
    expect(draft!.confidenceBps).toBe(8500);
    expect(draft!.warnings[0]).toContain('review');
  });

  it('parses JSON wrapped in a markdown fence (common with Anthropic)', async () => {
    mockComplete.mockResolvedValue(
      '```json\n{"reference":"FA-9","kind":"framework","countries":[],"currency":null,"globalRebatePercent":null,"effectiveDate":null,"expiryDate":null,"rateReviewSchedule":null,"rateCard":[]}\n```',
    );
    const draft = await extractContractFieldsLLM('text', LLM);
    expect(draft?.reference).toBe('FA-9');
    expect(draft?.kind).toBe('framework');
  });

  it('returns null when the model emits non-JSON', async () => {
    mockComplete.mockResolvedValue('I could not read that document, sorry.');
    expect(await extractContractFieldsLLM('text', LLM)).toBeNull();
  });

  it('returns null when the provider call throws (caller falls back to deterministic)', async () => {
    mockComplete.mockRejectedValue(new Error('HTTP 401'));
    expect(await extractContractFieldsLLM('text', LLM)).toBeNull();
  });

  it('drops invalid sub-values rather than failing the whole draft', async () => {
    mockComplete.mockResolvedValue(
      JSON.stringify({
        reference: null,
        kind: 'not-a-kind', // invalid enum → null
        countries: ['XX', 'toolong'],
        currency: 'dollars', // not 3 chars → null
        globalRebatePercent: null,
        effectiveDate: 'not a date',
        expiryDate: null,
        rateReviewSchedule: 'weekly', // invalid → null
        rateCard: [],
      }),
    );
    const draft = await extractContractFieldsLLM('text', LLM);
    expect(draft).not.toBeNull();
    expect(draft!.kind).toBeNull();
    expect(draft!.countries).toEqual(['XX']);
    expect(draft!.currency).toBeNull();
    expect(draft!.effectiveDate).toBeNull();
    expect(draft!.rateReviewSchedule).toBeNull();
  });
});
