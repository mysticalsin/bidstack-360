import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { extractContractFieldsLLM } from './contract-extract-llm.js';
import { completeChat, resolveLlmFromEnv, type ResolvedLlm } from './llm-provider.js';

const FIX = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__');
const completion = JSON.parse(readFileSync(join(FIX, 'llm-msa-completion.json'), 'utf8')) as unknown;

const LLM: ResolvedLlm = {
  kind: 'openai',
  apiKey: 'sk-fixture-not-real',
  model: 'gpt-4o-mini',
  baseUrl: 'https://api.openai.com/v1',
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('LLM MSA extraction HTTP contract (recorded fixtures, no network)', () => {
  it('does not resolve a provider (so callers never hit the network) when LLM is off', () => {
    expect(resolveLlmFromEnv({})).toBeNull();
    expect(resolveLlmFromEnv({ RFP_LLM_PROVIDER: 'openai' })).toBeNull();
    expect(resolveLlmFromEnv({ RFP_LLM_PROVIDER: 'anthropic' })).toBeNull();
  });

  it('posts the recorded OpenAI chat completion and maps it to a review-required draft', async () => {
    const calls: Array<{ url: string; authorization: string | null; body: string }> = [];
    vi.stubGlobal('fetch', async (input: string | URL, init: RequestInit = {}) => {
      const url = String(input);
      if (!url.startsWith('https://api.openai.com/v1/chat/completions')) {
        throw new Error(`http contract: unexpected URL ${url} (network blocked)`);
      }
      const headers = new Headers(init.headers);
      calls.push({ url, authorization: headers.get('authorization'), body: String(init.body ?? '') });
      return new Response(JSON.stringify(completion), { status: 200, headers: { 'content-type': 'application/json' } });
    });

    const draft = await extractContractFieldsLLM('Master services agreement between Polo and Acme.', LLM);
    expect(draft).toMatchObject({
      reference: 'MSA-2026-001',
      kind: 'msa',
      countries: ['FR', 'DE'],
      currency: 'EUR',
      globalRebateBps: 750,
      rateReviewSchedule: 'annual',
    });
    expect(draft!.rateCard).toEqual([
      { role: 'Senior Consultant', rateMicros: 850_000_000, unit: 'day', currency: 'EUR' },
    ]);
    expect(draft!.warnings[0]).toMatch(/review every field/);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.authorization).toBe('Bearer sk-fixture-not-real');
    const sent = JSON.parse(calls[0]!.body) as { model: string; response_format?: { type: string }; messages: Array<{ role: string }> };
    expect(sent.model).toBe('gpt-4o-mini');
    expect(sent.response_format).toEqual({ type: 'json_object' });
    expect(sent.messages.some((m) => m.role === 'system')).toBe(true);
  });

  it('does not leak the API key when the recorded provider answers 401', async () => {
    vi.stubGlobal('fetch', async () => new Response('{"error":{"message":"invalid_api_key"}}', { status: 401 }));
    await expect(completeChat(LLM, { user: 'ping', maxTokens: 8, timeoutMs: 1_000 })).rejects.toThrow(/401/);
    await expect(completeChat(LLM, { user: 'ping', maxTokens: 8, timeoutMs: 1_000 })).rejects.toThrow(
      expect.not.stringContaining('sk-fixture-not-real'),
    );
  });
});
