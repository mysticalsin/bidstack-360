import { describe, it, expect, vi, beforeEach } from 'vitest';
import type pino from 'pino';
import type { DustClient } from '@bidstack/dust-client';

// Mock the audit sink (writes to the DB) and the provider module so the test
// exercises only the tiering/fail-open contract, not real network or Prisma.
vi.mock('./ai-audit-worker.js', () => ({ logAiInvocation: vi.fn().mockResolvedValue(undefined) }));
vi.mock('./llm-provider.js', () => ({ resolveLlmFromEnv: vi.fn(), completeChat: vi.fn() }));
// Per-org provider resolution is exercised in org-llm.test.ts; here it defaults
// to null so the env-tier path is what these tiering assertions observe.
vi.mock('./org-llm.js', () => ({ resolveOrgLlm: vi.fn().mockResolvedValue(null) }));

import { runRfpCompletion } from './rfp-llm.js';
import { resolveLlmFromEnv, completeChat } from './llm-provider.js';
import { resolveOrgLlm } from './org-llm.js';
import { logAiInvocation } from './ai-audit-worker.js';

const mockResolve = vi.mocked(resolveLlmFromEnv);
const mockResolveOrg = vi.mocked(resolveOrgLlm);
const mockComplete = vi.mocked(completeChat);
const mockLogAiInvocation = vi.mocked(logAiInvocation);
const log = { warn: vi.fn(), info: vi.fn(), error: vi.fn() } as unknown as pino.Logger;

const base = {
  orgId: '11111111-1111-4111-8111-111111111111',
  log,
  agentId: 'agent-1',
  userMessage: 'prompt',
  agentType: 'rfp-test',
};

beforeEach(() => {
  vi.clearAllMocks();
  mockResolveOrg.mockResolvedValue(null);
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

  it('tier 0: the per-org provider takes precedence over the env provider', async () => {
    mockResolveOrg.mockResolvedValue({
      kind: 'moonshot',
      apiKey: 'org-k',
      model: 'kimi-x',
      baseUrl: 'https://api.moonshot.ai/v1',
    });
    // An env provider is also configured — the org one must win.
    mockResolve.mockReturnValue({ kind: 'openai', apiKey: 'env-k', model: 'm', baseUrl: 'b' });
    mockComplete.mockResolvedValue('org answer');

    const r = await runRfpCompletion({ ...base, dust: null });

    expect(r).toEqual({ text: 'org answer', provider: 'moonshot' });
    expect(mockResolve).not.toHaveBeenCalled(); // env never consulted once org resolves
  });

  it('tier 2: falls through to the Dust agent when no direct provider is set', async () => {
    mockResolve.mockReturnValue(null);
    const runAgent = vi.fn().mockResolvedValue({ status: 'succeeded', output: 'draft', run_id: 'r1' });
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

  it('falls through to Dust when the direct provider fails', async () => {
    mockResolve.mockReturnValue({ kind: 'openai', apiKey: 'k', model: 'm', baseUrl: 'b' });
    mockComplete.mockRejectedValue(new Error('boom'));
    const runAgent = vi.fn().mockResolvedValue({ status: 'succeeded', output: 'dust draft', run_id: 'r2' });
    const dust = { runAgent } as unknown as DustClient;

    const r = await runRfpCompletion({ ...base, dust });

    expect(r).toEqual({ text: 'dust draft', provider: 'dust', runId: 'r2' });
    expect(runAgent).toHaveBeenCalledOnce();
  });

  it('does not fall through to Dust when cancellation aborts the direct provider', async () => {
    const ctl = new AbortController();
    ctl.abort();
    mockResolve.mockReturnValue({ kind: 'openai', apiKey: 'k', model: 'm', baseUrl: 'b' });
    const err = new Error('aborted');
    err.name = 'AbortError';
    mockComplete.mockRejectedValue(err);
    const runAgent = vi.fn().mockResolvedValue({ status: 'succeeded', output: 'dust draft', run_id: 'r2' });
    const dust = { runAgent } as unknown as DustClient;

    await expect(runRfpCompletion({ ...base, dust, signal: ctl.signal })).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(runAgent).not.toHaveBeenCalled();
    expect(log.warn).not.toHaveBeenCalled();
    expect(mockLogAiInvocation).not.toHaveBeenCalled();
  });

  it('does not record an AI failure when cancellation aborts the Dust tier', async () => {
    const ctl = new AbortController();
    ctl.abort();
    mockResolve.mockReturnValue(null);
    const err = new Error('aborted');
    err.name = 'AbortError';
    const dust = {
      runAgent: vi.fn().mockRejectedValue(err),
    } as unknown as DustClient;

    await expect(runRfpCompletion({ ...base, dust, signal: ctl.signal })).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(log.warn).not.toHaveBeenCalled();
    expect(mockLogAiInvocation).not.toHaveBeenCalled();
  });

  it('returns null when Dust does not succeed with output', async () => {
    mockResolve.mockReturnValue(null);
    const dust = {
      runAgent: vi.fn().mockResolvedValue({ status: 'running', output: 'not ready', run_id: 'r3' }),
    } as unknown as DustClient;

    const r = await runRfpCompletion({ ...base, dust });

    expect(r).toBeNull();
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
