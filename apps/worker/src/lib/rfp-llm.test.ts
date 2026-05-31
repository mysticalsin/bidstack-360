import { describe, it, expect, vi, beforeEach } from 'vitest';
import type pino from 'pino';
import type { DustClient } from '@bidstack/dust-client';

// Mock the audit sink (writes to the DB) and the provider module so the test
// exercises only the tiering/fail-open contract, not real network or Prisma.
vi.mock('./ai-audit-worker.js', () => ({ logAiInvocation: vi.fn().mockResolvedValue(undefined) }));
vi.mock('./llm-provider.js', () => ({ resolveLlmFromEnv: vi.fn(), completeChat: vi.fn() }));

import { runRfpCompletion } from './rfp-llm.js';
import { resolveLlmFromEnv, completeChat } from './llm-provider.js';

const mockResolve = vi.mocked(resolveLlmFromEnv);
const mockComplete = vi.mocked(completeChat);
const log = { warn: vi.fn(), info: vi.fn(), error: vi.fn() } as unknown as pino.Logger;

const base = { orgId: 'o', log, agentId: 'agent-1', userMessage: 'prompt', agentType: 'rfp-test' };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('runRfpCompletion tiering', () => {
  it('tier 1: uses the direct LLM provider when one is env-configured', async () => {
    mockResolve.mockReturnValue({
      kind: 'anthropic',
      apiKey: 'k',
      model: 'claude-x',
      baseUrl: 'https://api.anthropic.com',
    });
    mockComplete.mockResolvedValue('{"ok":1}');
    const dust = { runAgent: vi.fn() } as unknown as DustClient;

    const r = await runRfpCompletion({ ...base, dust });

    expect(r).toEqual({ text: '{"ok":1}', provider: 'anthropic' });
    expect(mockComplete).toHaveBeenCalledOnce();
    expect(
      (dust as unknown as { runAgent: ReturnType<typeof vi.fn> }).runAgent,
    ).not.toHaveBeenCalled();
  });

  it('tier 2: falls through to the Dust agent when no direct provider is set', async () => {
    mockResolve.mockReturnValue(null);
    const runAgent = vi.fn().mockResolvedValue({ output: 'draft', run_id: 'r1' });
    const dust = { runAgent } as unknown as DustClient;

    const r = await runRfpCompletion({ ...base, dust });

    expect(r).toEqual({ text: 'draft', provider: 'dust', runId: 'r1' });
    expect(mockComplete).not.toHaveBeenCalled();
  });

  it('tier 3: returns null when nothing is configured', async () => {
    mockResolve.mockReturnValue(null);
    const r = await runRfpCompletion({ ...base, dust: null });
    expect(r).toBeNull();
  });

  it('returns null on direct-provider error and does NOT silently fall through to Dust', async () => {
    mockResolve.mockReturnValue({ kind: 'openai', apiKey: 'k', model: 'm', baseUrl: 'b' });
    mockComplete.mockRejectedValue(new Error('boom'));
    const runAgent = vi.fn();
    const dust = { runAgent } as unknown as DustClient;

    const r = await runRfpCompletion({ ...base, dust });

    expect(r).toBeNull();
    expect(runAgent).not.toHaveBeenCalled();
  });

  it('returns null when the Dust call throws', async () => {
    mockResolve.mockReturnValue(null);
    const dust = {
      runAgent: vi.fn().mockRejectedValue(new Error('dust down')),
    } as unknown as DustClient;
    const r = await runRfpCompletion({ ...base, dust });
    expect(r).toBeNull();
  });
});
