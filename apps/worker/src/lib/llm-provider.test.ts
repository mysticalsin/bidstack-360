import { describe, it, expect, vi, afterEach } from 'vitest';

import { resolveLlmFromEnv, completeChat, coerceJsonObject } from './llm-provider.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('resolveLlmFromEnv', () => {
  it('returns null when no provider is configured or provider is dust', () => {
    expect(resolveLlmFromEnv({})).toBeNull();
    expect(resolveLlmFromEnv({ RFP_LLM_PROVIDER: 'dust' })).toBeNull();
  });

  it('returns null when a provider is selected but its API key is missing', () => {
    expect(resolveLlmFromEnv({ RFP_LLM_PROVIDER: 'openai' })).toBeNull();
    expect(resolveLlmFromEnv({ RFP_LLM_PROVIDER: 'anthropic' })).toBeNull();
  });

  it('resolves openai with sensible defaults', () => {
    expect(resolveLlmFromEnv({ RFP_LLM_PROVIDER: 'openai', OPENAI_API_KEY: 'sk-x' })).toMatchObject(
      {
        kind: 'openai',
        apiKey: 'sk-x',
        model: 'gpt-4o-mini',
        baseUrl: 'https://api.openai.com/v1',
      },
    );
  });

  it('resolves anthropic (Claude) and honours a model override', () => {
    expect(
      resolveLlmFromEnv({
        RFP_LLM_PROVIDER: 'anthropic',
        ANTHROPIC_API_KEY: 'k',
        ANTHROPIC_MODEL: 'claude-custom',
      }),
    ).toMatchObject({
      kind: 'anthropic',
      model: 'claude-custom',
      baseUrl: 'https://api.anthropic.com',
    });
  });

  it('resolves moonshot (Kimi) including the "kimi" alias', () => {
    expect(resolveLlmFromEnv({ RFP_LLM_PROVIDER: 'kimi', MOONSHOT_API_KEY: 'k' })).toMatchObject({
      kind: 'moonshot',
      baseUrl: 'https://api.moonshot.ai/v1',
    });
  });

  it('resolves NVIDIA NIM with the hosted OpenAI-compatible endpoint', () => {
    expect(resolveLlmFromEnv({ RFP_LLM_PROVIDER: 'nim', NVIDIA_NIM_API_KEY: 'nv-k' })).toMatchObject(
      {
        kind: 'nim',
        apiKey: 'nv-k',
        model: 'deepseek-ai/deepseek-v4-pro',
        baseUrl: 'https://integrate.api.nvidia.com/v1',
        extraBody: { chat_template_kwargs: { thinking: false } },
      },
    );
  });

  it('supports NVIDIA NIM aliases, model override, base URL trimming, and thinking opt-in', () => {
    expect(
      resolveLlmFromEnv({
        RFP_LLM_PROVIDER: 'nvidia-nim',
        NVIDIA_NIM_API_KEY: 'nv-k',
        NVIDIA_NIM_MODEL: 'nvidia/nemotron-x',
        NVIDIA_NIM_BASE_URL: 'https://example.test/v1/',
        NVIDIA_NIM_ALLOW_CUSTOM_BASE_URL: 'true',
        NVIDIA_NIM_THINKING: 'true',
      }),
    ).toMatchObject({
      kind: 'nim',
      model: 'nvidia/nemotron-x',
      baseUrl: 'https://example.test/v1',
      extraBody: { chat_template_kwargs: { thinking: true } },
    });
  });

  it('does not resolve NVIDIA NIM without an API key', () => {
    expect(resolveLlmFromEnv({ RFP_LLM_PROVIDER: 'nim' })).toBeNull();
  });

  it('rejects unsafe NVIDIA NIM custom base URLs', () => {
    expect(() =>
      resolveLlmFromEnv({
        RFP_LLM_PROVIDER: 'nim',
        NVIDIA_NIM_API_KEY: 'nv-k',
        NVIDIA_NIM_BASE_URL: 'http://127.0.0.1:8080/v1',
        NVIDIA_NIM_ALLOW_CUSTOM_BASE_URL: 'true',
      }),
    ).toThrow(/custom base URL must use https/);
  });

  it('resolves gemma LOCALLY and keyless by default (open weights via Ollama)', () => {
    expect(resolveLlmFromEnv({ RFP_LLM_PROVIDER: 'gemma' })).toMatchObject({
      kind: 'gemma',
      apiKey: 'local',
      baseUrl: 'http://localhost:11434/v1',
    });
  });

  it('resolves gemma against a hosted gateway when GEMMA_BASE_URL + key are set', () => {
    expect(
      resolveLlmFromEnv({
        RFP_LLM_PROVIDER: 'gemma',
        GEMMA_API_KEY: 'k',
        GEMMA_MODEL: 'gemma4',
        GEMMA_BASE_URL: 'https://openrouter.ai/api/v1',
      }),
    ).toMatchObject({
      kind: 'gemma',
      apiKey: 'k',
      model: 'gemma4',
      baseUrl: 'https://openrouter.ai/api/v1',
    });
  });
});

describe('coerceJsonObject', () => {
  it('unwraps a fenced json block', () => {
    expect(coerceJsonObject('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });
  it('extracts the object from surrounding prose', () => {
    expect(coerceJsonObject('Sure, here it is: {"a":1} — hope that helps')).toBe('{"a":1}');
  });
});

describe('completeChat', () => {
  it('posts to the OpenAI-compatible endpoint with bearer auth + system/user messages', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: '{"requirements":[]}' } }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const out = await completeChat(
      {
        kind: 'openai',
        apiKey: 'sk-x',
        model: 'gpt-4o-mini',
        baseUrl: 'https://api.openai.com/v1',
      },
      { system: 'sys', user: 'hi' },
    );

    expect(out).toBe('{"requirements":[]}');
    const [url, opts] = fetchMock.mock.calls[0] as [
      string,
      RequestInit & { headers: Record<string, string> },
    ];
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect(opts.headers.authorization).toBe('Bearer sk-x');
    const body = JSON.parse(opts.body as string);
    expect(body.model).toBe('gpt-4o-mini');
    expect(body.messages).toEqual([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'hi' },
    ]);
  });

  it('posts to /v1/messages with anthropic headers for Claude', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ content: [{ text: '{"ok":true}' }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const out = await completeChat(
      { kind: 'anthropic', apiKey: 'ak', model: 'claude-x', baseUrl: 'https://api.anthropic.com' },
      { user: 'hi' },
    );

    expect(out).toBe('{"ok":true}');
    const [url, opts] = fetchMock.mock.calls[0] as [string, { headers: Record<string, string> }];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(opts.headers['x-api-key']).toBe('ak');
    expect(opts.headers['anthropic-version']).toBe('2023-06-01');
  });

  it('uses the Moonshot base url for kimi', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: 'x' } }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await completeChat(
      {
        kind: 'moonshot',
        apiKey: 'mk',
        model: 'moonshot-v1-32k',
        baseUrl: 'https://api.moonshot.ai/v1',
      },
      { user: 'hi' },
    );

    expect((fetchMock.mock.calls[0] as [string])[0]).toBe(
      'https://api.moonshot.ai/v1/chat/completions',
    );
  });

  it('uses the NVIDIA NIM base URL and provider extra body', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: 'nim-ok' } }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await completeChat(
      {
        kind: 'nim',
        apiKey: 'nv-k',
        model: 'deepseek-ai/deepseek-v4-pro',
        baseUrl: 'https://integrate.api.nvidia.com/v1',
        extraBody: { chat_template_kwargs: { thinking: false } },
      },
      { user: 'hi' },
    );

    const [url, opts] = fetchMock.mock.calls[0] as [
      string,
      RequestInit & { headers: Record<string, string> },
    ];
    expect(url).toBe('https://integrate.api.nvidia.com/v1/chat/completions');
    expect(opts.headers.authorization).toBe('Bearer nv-k');
    const body = JSON.parse(opts.body as string);
    expect(body.model).toBe('deepseek-ai/deepseek-v4-pro');
    expect(body.chat_template_kwargs).toEqual({ thinking: false });
  });

  it('sets response_format ONLY when responseFormat is json_object (Markdown steps stay free)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: '{}' } }] }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const llm = {
      kind: 'openai' as const,
      apiKey: 'k',
      model: 'm',
      baseUrl: 'https://api.openai.com/v1',
    };

    await completeChat(llm, { user: 'hi' }); // no responseFormat → must NOT force JSON
    await completeChat(llm, { user: 'hi', responseFormat: 'json_object' });

    const body0 = JSON.parse((fetchMock.mock.calls[0] as [string, { body: string }])[1].body);
    const body1 = JSON.parse((fetchMock.mock.calls[1] as [string, { body: string }])[1].body);
    expect(body0.response_format).toBeUndefined();
    expect(body1.response_format).toEqual({ type: 'json_object' });
  });

  it('passes an already-aborted external signal into provider fetch', async () => {
    const ctl = new AbortController();
    ctl.abort();
    const fetchMock = vi.fn((_url: string, opts: RequestInit) => {
      expect(opts.signal?.aborted).toBe(true);
      throw new DOMException('Aborted', 'AbortError');
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      completeChat(
        {
          kind: 'openai',
          apiKey: 'secret-key',
          model: 'm',
          baseUrl: 'https://api.openai.com/v1',
        },
        { user: 'hi', signal: ctl.signal },
      ),
    ).rejects.toThrow(/Aborted/);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('throws an HTTP error without leaking the API key', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      completeChat(
        { kind: 'openai', apiKey: 'secret-key', model: 'm', baseUrl: 'https://api.openai.com/v1' },
        { user: 'hi' },
      ),
    ).rejects.toThrow(/HTTP 401/);
  });

  it('treats NVIDIA NIM pending responses as incomplete instead of success', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 202, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      completeChat(
        {
          kind: 'nim',
          apiKey: 'nv-secret',
          model: 'deepseek-ai/deepseek-v4-pro',
          baseUrl: 'https://integrate.api.nvidia.com/v1',
        },
        { user: 'hi' },
      ),
    ).rejects.toThrow(/HTTP 202/);
  });

  it('treats empty OpenAI-compatible completions as failed output', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: '' } }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      completeChat(
        {
          kind: 'openai',
          apiKey: 'secret-key',
          model: 'm',
          baseUrl: 'https://api.openai.com/v1',
        },
        { user: 'hi' },
      ),
    ).rejects.toThrow(/empty content/);
  });
});
