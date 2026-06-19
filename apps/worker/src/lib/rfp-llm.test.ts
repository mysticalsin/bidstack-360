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
vi.mock('@bidstack/db/serum-runtime-policy', () => ({
  SERUM_RUNTIME_CONFIG_KEYS: { modelRouter: 'routing', promptLibrary: 'governance' },
  checkSerumModelRouterRuntimePolicy: vi.fn(),
  checkSerumPromptLibraryRuntimePolicy: vi.fn(),
}));

import { runRfpCompletion } from './rfp-llm.js';
import { resolveLlmFromEnv, completeChat } from './llm-provider.js';
import { resolveOrgLlm } from './org-llm.js';
import { logAiInvocation } from './ai-audit-worker.js';
import {
  checkSerumModelRouterRuntimePolicy,
  checkSerumPromptLibraryRuntimePolicy,
} from '@bidstack/db/serum-runtime-policy';

const mockResolve = vi.mocked(resolveLlmFromEnv);
const mockResolveOrg = vi.mocked(resolveOrgLlm);
const mockComplete = vi.mocked(completeChat);
const mockLogAiInvocation = vi.mocked(logAiInvocation);
const mockCheckSerumModelRouter = vi.mocked(checkSerumModelRouterRuntimePolicy);
const mockCheckSerumPromptLibrary = vi.mocked(checkSerumPromptLibraryRuntimePolicy);
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
  mockCheckSerumPromptLibrary.mockResolvedValue({
    configType: 'prompt_library',
    configKey: 'governance',
    environment: 'dev',
    subject: 'rfp-test:rfp-test',
    allowed: true,
    status: 'allowed',
    reason: 'Prompt execution is allowed by the active SERUM policy.',
    activeConfigVersionId: '33333333-3333-4333-8333-333333333333',
  });
  mockCheckSerumModelRouter.mockResolvedValue({
    configType: 'model_router',
    configKey: 'routing',
    environment: 'dev',
    subject: 'openai',
    allowed: true,
    status: 'allowed',
    reason: 'Model route is allowed by the active SERUM policy.',
    activeConfigVersionId: '22222222-2222-4222-8222-222222222222',
  });
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
    expect(mockCheckSerumPromptLibrary).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: base.orgId,
        environment: 'dev',
        configKey: 'governance',
        operation: 'rfp-test',
        promptSet: 'rfp-test',
        versionedPrompt: true,
        injectionTested: true,
        productionApproved: true,
      }),
    );
    expect(mockCheckSerumModelRouter).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: base.orgId,
        environment: 'dev',
        configKey: 'routing',
        provider: 'claude',
        requestedMaxTokens: 4096,
        sourceCitationsRequired: true,
      }),
    );
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
    expect(mockCheckSerumModelRouter).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'kimi', requestedMaxTokens: 4096 }),
    );
    expect(mockResolve).not.toHaveBeenCalled(); // env never consulted once org resolves
  });

  it('tier 2: falls through to the Dust agent when no direct provider is set', async () => {
    mockResolve.mockReturnValue(null);
    const runAgent = vi.fn().mockResolvedValue({ status: 'succeeded', output: 'draft', run_id: 'r1' });
    const dust = { runAgent } as unknown as DustClient;

    const r = await runRfpCompletion({ ...base, dust });

    expect(r).toEqual({ text: 'draft', provider: 'dust', runId: 'r1' });
    expect(mockCheckSerumPromptLibrary).toHaveBeenCalledWith(
      expect.objectContaining({ operation: 'rfp-test', promptSet: 'rfp-test' }),
    );
    expect(mockCheckSerumModelRouter).not.toHaveBeenCalled();
    expect(mockComplete).not.toHaveBeenCalled();
  });

  it('tier 3: returns null when nothing is configured', async () => {
    mockResolve.mockReturnValue(null);
    const r = await runRfpCompletion({ ...base, dust: null });
    expect(r).toBeNull();
  });

  it('does not fall through to Dust when a SERUM-allowed direct provider fails', async () => {
    mockResolve.mockReturnValue({ kind: 'openai', apiKey: 'k', model: 'm', baseUrl: 'b' });
    mockComplete.mockRejectedValue(new Error('boom'));
    const runAgent = vi.fn().mockResolvedValue({ status: 'succeeded', output: 'dust draft', run_id: 'r2' });
    const dust = { runAgent } as unknown as DustClient;

    const r = await runRfpCompletion({ ...base, dust });

    expect(r).toBeNull();
    expect(runAgent).not.toHaveBeenCalled();
    expect(mockLogAiInvocation).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'error', errorMsg: 'boom' }),
      log,
    );
  });

  it('blocks a direct provider before execution when SERUM denies the route', async () => {
    mockResolve.mockReturnValue({ kind: 'nim', apiKey: 'k', model: 'm', baseUrl: 'b' });
    mockCheckSerumModelRouter.mockResolvedValueOnce({
      configType: 'model_router',
      configKey: 'routing',
      environment: 'dev',
      subject: 'nvidia_nim',
      allowed: false,
      status: 'denied',
      reason: 'Requested token budget exceeds the active SERUM router cap.',
      activeConfigVersionId: '22222222-2222-4222-8222-222222222222',
    });
    const runAgent = vi.fn().mockResolvedValue({ status: 'succeeded', output: 'dust draft', run_id: 'r2' });
    const dust = { runAgent } as unknown as DustClient;

    const r = await runRfpCompletion({
      ...base,
      dust,
      maxTokens: 9000,
      sourceCitationsRequired: false,
    });

    expect(r).toBeNull();
    expect(mockCheckSerumModelRouter).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'nvidia_nim',
        requestedMaxTokens: 9000,
        sourceCitationsRequired: false,
      }),
    );
    expect(mockComplete).not.toHaveBeenCalled();
    expect(runAgent).not.toHaveBeenCalled();
    expect(mockLogAiInvocation).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'error',
        errorMsg: expect.stringContaining('Requested token budget exceeds'),
      }),
      log,
    );
  });

  it('blocks model execution before router or Dust fallback when SERUM denies the prompt set', async () => {
    mockResolve.mockReturnValue({ kind: 'anthropic', apiKey: 'k', model: 'm', baseUrl: 'b' });
    mockCheckSerumPromptLibrary.mockResolvedValueOnce({
      configType: 'prompt_library',
      configKey: 'governance',
      environment: 'dev',
      subject: 'rfp-test:rfp-test',
      allowed: false,
      status: 'denied',
      reason: 'Prompt set is not in the active SERUM allowlist.',
      activeConfigVersionId: '33333333-3333-4333-8333-333333333333',
    });
    const runAgent = vi.fn().mockResolvedValue({ status: 'succeeded', output: 'dust draft', run_id: 'r2' });
    const dust = { runAgent } as unknown as DustClient;

    const r = await runRfpCompletion({ ...base, dust });

    expect(r).toBeNull();
    expect(mockComplete).not.toHaveBeenCalled();
    expect(mockCheckSerumModelRouter).not.toHaveBeenCalled();
    expect(runAgent).not.toHaveBeenCalled();
    expect(mockLogAiInvocation).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'error',
        errorMsg: expect.stringContaining('Prompt set is not in the active SERUM allowlist'),
      }),
      log,
    );
  });

  it('fails closed without model execution when the SERUM router check errors', async () => {
    mockResolve.mockReturnValue({ kind: 'gemma', apiKey: 'local', model: 'gemma3', baseUrl: 'b' });
    mockCheckSerumModelRouter.mockRejectedValueOnce(new Error('policy database unavailable'));
    const runAgent = vi.fn().mockResolvedValue({ status: 'succeeded', output: 'dust draft', run_id: 'r2' });
    const dust = { runAgent } as unknown as DustClient;

    const r = await runRfpCompletion({ ...base, dust });

    expect(r).toBeNull();
    expect(mockComplete).not.toHaveBeenCalled();
    expect(runAgent).not.toHaveBeenCalled();
    expect(mockLogAiInvocation).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'error',
        errorMsg: expect.stringContaining('policy database unavailable'),
      }),
      log,
    );
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
