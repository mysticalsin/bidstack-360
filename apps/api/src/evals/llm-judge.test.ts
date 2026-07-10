import { afterEach, describe, expect, it, vi } from 'vitest';

import { judgeFixture } from './llm-judge.js';
import type { GoldenFixture } from './types.js';

const ORIGINAL_ENV = {
  EVAL_MODE: process.env.EVAL_MODE,
  EVAL_LLM_PROVIDER: process.env.EVAL_LLM_PROVIDER,
  NVIDIA_NIM_API_KEY: process.env.NVIDIA_NIM_API_KEY,
  NVIDIA_NIM_MODEL: process.env.NVIDIA_NIM_MODEL,
  NVIDIA_NIM_BASE_URL: process.env.NVIDIA_NIM_BASE_URL,
  NVIDIA_NIM_THINKING: process.env.NVIDIA_NIM_THINKING,
};

const fixture: GoldenFixture = {
  id: 'unit',
  label: 'Unit fixture',
  sectionTitle: 'Executive Summary',
  storyContext: 'Reference says 20% cycle-time reduction.',
  draft: 'The proposal states a 20% cycle-time reduction.',
  expectations: { category: 'golden-good', maxPhantomRate: 0, mustBeGrounded: true },
};

afterEach(() => {
  vi.restoreAllMocks();
  // vi.stubGlobal('fetch', ...) is NOT undone by restoreAllMocks — without this
  // the mocked fetch leaks into later test files (serial worker, fileParallelism
  // off), causing cross-file flakiness in the full suite.
  vi.unstubAllGlobals();
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

describe('judgeFixture full mode with NVIDIA NIM', () => {
  it('posts an OpenAI-compatible JSON judge request without exposing the key in errors', async () => {
    process.env.EVAL_MODE = 'full';
    process.env.EVAL_LLM_PROVIDER = 'nim';
    process.env.NVIDIA_NIM_API_KEY = 'nv-test-key';
    process.env.NVIDIA_NIM_MODEL = 'deepseek-ai/deepseek-v4-pro';
    process.env.NVIDIA_NIM_BASE_URL = 'https://integrate.api.nvidia.com/v1/';

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                hallucination_score: 1,
                relevance_score: 0.9,
                completeness_score: 0.8,
                phantom_examples: [],
              }),
            },
          },
        ],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const score = await judgeFixture(fixture);

    expect(score.mode).toBe('llm');
    expect(score.overall).toBeCloseTo(0.925);
    const [url, init] = fetchMock.mock.calls[0] as [
      string,
      RequestInit & { headers: Record<string, string> },
    ];
    expect(url).toBe('https://integrate.api.nvidia.com/v1/chat/completions');
    expect(init.headers.authorization).toBe('Bearer nv-test-key');
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe('deepseek-ai/deepseek-v4-pro');
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body.chat_template_kwargs).toEqual({ thinking: false });
  });

  it('coerces fenced JSON and numeric string scores', async () => {
    process.env.EVAL_MODE = 'full';
    process.env.EVAL_LLM_PROVIDER = 'nim';
    process.env.NVIDIA_NIM_API_KEY = 'nv-test-key';

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        status: 200,
        json: async () => ({
          choices: [
            {
              message: {
                content:
                  '```json\n{"hallucination_score":"1","relevance_score":"0.8","completeness_score":"0.6","phantom_examples":[]}\n```',
              },
            },
          ],
        }),
      }),
    );

    const score = await judgeFixture(fixture);

    expect(score.hallucinationScore).toBe(1);
    expect(score.relevanceScore).toBe(0.8);
    expect(score.completenessScore).toBe(0.6);
  });

  it('rejects unsupported eval providers before calling a model', async () => {
    process.env.EVAL_MODE = 'full';
    process.env.EVAL_LLM_PROVIDER = 'nvidia_nim';
    process.env.NVIDIA_NIM_API_KEY = 'nv-test-key';
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(judgeFixture(fixture)).rejects.toThrow(/Unsupported EVAL_LLM_PROVIDER/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects unsafe NIM eval base URLs before sending the key', async () => {
    process.env.EVAL_MODE = 'full';
    process.env.EVAL_LLM_PROVIDER = 'nim';
    process.env.NVIDIA_NIM_API_KEY = 'nv-test-key';
    process.env.NVIDIA_NIM_BASE_URL = 'http://127.0.0.1:8080/v1';
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(judgeFixture(fixture)).rejects.toThrow(/NVIDIA NIM eval judge base URL/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects NIM 202 pending responses without leaking the key', async () => {
    process.env.EVAL_MODE = 'full';
    process.env.EVAL_LLM_PROVIDER = 'nim';
    process.env.NVIDIA_NIM_API_KEY = 'nv-test-key';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        status: 202,
        json: async () => ({ error: 'pending with sensitive body' }),
      }),
    );

    let message = '';
    await judgeFixture(fixture).catch((err: unknown) => {
      message = err instanceof Error ? err.message : String(err);
    });
    expect(message).toContain('NVIDIA NIM eval judge error: 202');
    expect(message).not.toMatch(/nv-test-key|sensitive body/);
  });

  it('rejects out-of-range judge scores', async () => {
    process.env.EVAL_MODE = 'full';
    process.env.EVAL_LLM_PROVIDER = 'nim';
    process.env.NVIDIA_NIM_API_KEY = 'nv-test-key';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        status: 200,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  hallucination_score: 2,
                  relevance_score: 0.9,
                  completeness_score: 0.8,
                  phantom_examples: [],
                }),
              },
            },
          ],
        }),
      }),
    );

    await expect(judgeFixture(fixture)).rejects.toThrow();
  });
});
