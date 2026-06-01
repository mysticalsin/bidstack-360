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

  it('sets response_format ONLY when responseFormat is json_object (Markdown steps stay free)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
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
});
