import { beforeEach, describe, expect, it, vi } from 'vitest';
import type pino from 'pino';

vi.mock('../lib/dust-credentials.js', () => ({
  resolveOrgDustCredentials: vi.fn(),
  resolveAgentId: vi.fn((_creds, _purpose, fallback) => fallback ?? null),
}));
vi.mock('../lib/llm-provider.js', () => ({ resolveLlmFromEnv: vi.fn() }));
vi.mock('../lib/rfp-llm.js', () => ({ runRfpCompletion: vi.fn() }));

import { createDustExecutor } from './dust-executor.js';
import { resolveOrgDustCredentials } from '../lib/dust-credentials.js';
import { resolveLlmFromEnv } from '../lib/llm-provider.js';
import { runRfpCompletion } from '../lib/rfp-llm.js';

const mockCredentials = vi.mocked(resolveOrgDustCredentials);
const mockResolveLlm = vi.mocked(resolveLlmFromEnv);
const mockRunRfpCompletion = vi.mocked(runRfpCompletion);
const log = { warn: vi.fn(), info: vi.fn(), error: vi.fn() } as unknown as pino.Logger;

const taskInput = {
  agent: {
    id: 'finance',
    role: 'Finance Lead',
    goal: 'Review P&L',
    backstory: 'Commercial reviewer',
  },
  task: {
    id: 'pricing',
    agentId: 'finance',
    description: 'Review pricing',
    expectedOutput: 'Commercial review',
  },
  prompt: 'Review this RFP commercial model',
  inputs: {},
};

describe('createDustExecutor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCredentials.mockResolvedValue(null);
    mockResolveLlm.mockReturnValue(null);
  });

  it('uses the direct RFP LLM provider when Dust is not configured', async () => {
    const ctl = new AbortController();
    mockResolveLlm.mockReturnValue({
      kind: 'nim',
      apiKey: 'nv-k',
      model: 'deepseek-ai/deepseek-v4-pro',
      baseUrl: 'https://integrate.api.nvidia.com/v1',
    });
    mockRunRfpCompletion.mockResolvedValue({ text: 'finance review', provider: 'nim' });

    const executor = await createDustExecutor(log, 'org-1');
    const result = await executor.run({ ...taskInput, signal: ctl.signal });

    expect(result).toEqual({ output: 'finance review', ok: true });
    expect(mockRunRfpCompletion).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: 'org-1',
        dust: null,
        agentType: 'crew-finance',
        responseFormat: 'text',
        signal: ctl.signal,
      }),
    );
  });

  it('returns a clear placeholder when no provider is configured', async () => {
    const executor = await createDustExecutor(log, 'org-1');
    const result = await executor.run(taskInput);

    expect(result.ok).toBe(false);
    expect(result.error).toBe('llm_not_configured');
    expect(mockRunRfpCompletion).not.toHaveBeenCalled();
  });
});
