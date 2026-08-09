import { describe, expect, it } from 'vitest';

import {
  AGENT_PROVIDER_ACTIVE_NAME,
  DIRECT_PROVIDER_TO_KIND,
  agentProviderCredentialName,
  buildResolvedLlm,
  coerceJsonObject,
  isDirectAgentProvider,
} from './index.js';

describe('buildResolvedLlm', () => {
  it('maps each brand provider id to its wire family', () => {
    expect(buildResolvedLlm({ provider: 'claude', apiKey: 'k' }).kind).toBe('anthropic');
    expect(buildResolvedLlm({ provider: 'openai', apiKey: 'k' }).kind).toBe('openai');
    expect(buildResolvedLlm({ provider: 'omniroute' }).kind).toBe('openai');
    expect(buildResolvedLlm({ provider: 'kimi', apiKey: 'k' }).kind).toBe('moonshot');
    expect(buildResolvedLlm({ provider: 'nvidia_nim', apiKey: 'k' }).kind).toBe('nim');
    expect(buildResolvedLlm({ provider: 'gemma' }).kind).toBe('gemma');
  });

  it('fills model + baseUrl from defaults when omitted', () => {
    const llm = buildResolvedLlm({ provider: 'openai', apiKey: 'k' });
    expect(llm.model).toBe('gpt-4o-mini');
    expect(llm.baseUrl).toBe('https://api.openai.com/v1');
  });

  it('honours explicit model + baseUrl overrides', () => {
    const llm = buildResolvedLlm({
      provider: 'kimi',
      apiKey: 'k',
      model: 'moonshot-v1-128k',
      baseUrl: 'https://api.moonshot.ai/v1/',
    });
    expect(llm.model).toBe('moonshot-v1-128k');
    // trailing slash trimmed so completeChat can append the path cleanly
    expect(llm.baseUrl).toBe('https://api.moonshot.ai/v1');
  });

  it('normalises a pasted Anthropic /v1/messages base back to the host root', () => {
    // completeChat appends /v1/messages, so the stored base must not include it.
    const llm = buildResolvedLlm({
      provider: 'claude',
      apiKey: 'k',
      baseUrl: 'https://api.anthropic.com/v1/messages',
    });
    expect(llm.baseUrl).toBe('https://api.anthropic.com');
  });

  it('uses a placeholder key for keyless local Gemma', () => {
    expect(buildResolvedLlm({ provider: 'gemma' }).apiKey).toBe('local');
  });

  describe('omniroute (keyless local OpenAI-compatible gateway)', () => {
    it('resolves to its own defaults, not openai kind defaults', () => {
      // Regression: omniroute shares the 'openai' wire kind, so without a
      // per-provider-id override it would silently inherit api.openai.com +
      // gpt-4o-mini instead of the local gateway.
      const llm = buildResolvedLlm({ provider: 'omniroute' });
      expect(llm.kind).toBe('openai');
      expect(llm.baseUrl).toBe('http://localhost:20128/v1');
      expect(llm.model).toBe('auto');
      expect(llm.apiKey).toBeTruthy();
    });

    it('forces stream:false via extraBody so completeChat gets parseable JSON', () => {
      // Regression: OmniRoute defaults to SSE streaming; without stream:false
      // completeChat's `res.json()` on the OpenAI-compatible path would fail
      // to parse a text/event-stream body.
      expect(buildResolvedLlm({ provider: 'omniroute' }).extraBody).toEqual({ stream: false });
    });

    it('lets explicit input.baseUrl and input.model override the omniroute defaults', () => {
      const llm = buildResolvedLlm({
        provider: 'omniroute',
        baseUrl: 'http://localhost:9999/v1',
        model: 'llama-3.1-70b',
      });
      expect(llm.baseUrl).toBe('http://localhost:9999/v1');
      expect(llm.model).toBe('llama-3.1-70b');
      // extraBody is provider-level, not overridden by baseUrl/model input.
      expect(llm.extraBody).toEqual({ stream: false });
    });
  });
});

describe('storage-key helpers (shared by API writes + worker reads)', () => {
  it('builds the per-provider credential name', () => {
    expect(agentProviderCredentialName('openai')).toBe('agent-provider:openai');
  });
  it('names the active selector row distinctly from any provider', () => {
    expect(AGENT_PROVIDER_ACTIVE_NAME).toBe('agent-provider:__active__');
    expect(isDirectAgentProvider('__active__')).toBe(false);
  });
  it('recognises only the six supported provider ids', () => {
    for (const id of Object.keys(DIRECT_PROVIDER_TO_KIND)) {
      expect(isDirectAgentProvider(id)).toBe(true);
    }
    expect(isDirectAgentProvider('bogus')).toBe(false);
  });
});

describe('coerceJsonObject', () => {
  it('extracts a JSON object from a fenced markdown block', () => {
    expect(coerceJsonObject('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });
  it('extracts a JSON object surrounded by prose', () => {
    expect(coerceJsonObject('Here you go: {"a":1} thanks')).toBe('{"a":1}');
  });
});
