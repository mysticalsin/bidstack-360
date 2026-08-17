import { describe, expect, it } from 'vitest';

import {
  AGENT_PROVIDER_ACTIVE_NAME,
  CLOUDFLARE_DEFAULT_MODEL,
  CLOUDFLARE_WORKERS_AI_MODELS,
  DIRECT_PROVIDER_TO_KIND,
  agentProviderCredentialName,
  buildResolvedLlm,
  cloudflareWorkersAiBaseUrl,
  coerceJsonObject,
  isCloudflareAccountId,
  isDirectAgentProvider,
  isRunnableLlm,
  normalizeCloudflareBaseUrl,
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
      expect(llm.model).toBe('auto/best-free');
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

  describe('cloudflare (Workers AI — account-scoped OpenAI-compatible endpoint)', () => {
    const ACCOUNT = '0123456789abcdef0123456789abcdef';

    it('composes the account-scoped base URL from a bare account id', () => {
      // The stored credential shape is {apiKey, model, baseUrl} with no room
      // for an account id, so baseUrl carries either form and is normalised
      // here. A bare id must become the full Workers AI endpoint.
      const llm = buildResolvedLlm({ provider: 'cloudflare', apiKey: 'cf', baseUrl: ACCOUNT });
      expect(llm.kind).toBe('openai');
      expect(llm.baseUrl).toBe(
        `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/ai/v1`,
      );
    });

    it('accepts a full URL unchanged (AI Gateway routes stay usable)', () => {
      const gateway = 'https://gateway.ai.cloudflare.com/v1/acc/gw/compat';
      expect(
        buildResolvedLlm({ provider: 'cloudflare', apiKey: 'cf', baseUrl: `${gateway}/` }).baseUrl,
      ).toBe(gateway);
    });

    it('does NOT inherit openai defaults despite sharing the wire kind', () => {
      // Same trap omniroute has: 'cloudflare' maps to kind 'openai', so without
      // its own override it would call api.openai.com with gpt-4o-mini.
      const llm = buildResolvedLlm({ provider: 'cloudflare', apiKey: 'cf', baseUrl: ACCOUNT });
      expect(llm.baseUrl).not.toContain('api.openai.com');
      expect(llm.model).toBe(CLOUDFLARE_DEFAULT_MODEL);
    });

    it('defaults to a model that is BOTH large-context and non-reasoning', () => {
      // Two independent constraints, both measured against the live endpoint:
      // (1) document-extract.ts sends up to 80,000 CHARACTERS in one prompt, so
      //     llama-3.3-70b's 24k window would truncate it;
      // (2) a reasoning model spends a small max_tokens budget on its
      //     chain-of-thought and returns content:null — which completeChat
      //     reports as "empty content", so the 512-token connectivity probe and
      //     any short copilot call would read as a dead provider.
      const def = CLOUDFLARE_WORKERS_AI_MODELS.find((m) => m.id === CLOUDFLARE_DEFAULT_MODEL);
      expect(def).toBeDefined();
      expect(def!.contextTokens).toBeGreaterThanOrEqual(100_000);
      expect(def!.reasoning).toBeFalsy();
    });

    it('flags reasoning models so the picker can warn and the default can avoid them', () => {
      const reasoning = CLOUDFLARE_WORKERS_AI_MODELS.filter((m) => m.reasoning);
      expect(reasoning.length).toBeGreaterThan(0);
      expect(reasoning.map((m) => m.id)).toContain('@cf/zai-org/glm-4.7-flash');
      // Every flagged model says so in its note, so the UI needs no extra copy.
      for (const m of reasoning) expect(m.note.toLowerCase()).toContain('reasoning model');
    });

    it('every catalogued model is a @cf/ id with a real context window', () => {
      for (const model of CLOUDFLARE_WORKERS_AI_MODELS) {
        expect(model.id.startsWith('@cf/')).toBe(true);
        expect(model.contextTokens).toBeGreaterThan(0);
      }
    });

    it('yields an EMPTY base URL when the account id is missing, and that is not runnable', () => {
      // The failure this pins: a credential saved with a key but no account id
      // used to resolve "successfully" and then throw "Failed to parse URL"
      // inside a background job on every call.
      const llm = buildResolvedLlm({ provider: 'cloudflare', apiKey: 'cf' });
      expect(llm.baseUrl).toBe('');
      expect(isRunnableLlm(llm)).toBe(false);
      expect(isRunnableLlm(buildResolvedLlm({ provider: 'openai', apiKey: 'k' }))).toBe(true);
    });

    it('rejects a value that is neither an account id nor a URL', () => {
      expect(normalizeCloudflareBaseUrl('not-an-account')).toBeNull();
      expect(normalizeCloudflareBaseUrl('')).toBeNull();
      expect(normalizeCloudflareBaseUrl(undefined)).toBeNull();
      expect(isCloudflareAccountId(ACCOUNT)).toBe(true);
      expect(isCloudflareAccountId(`${ACCOUNT}0`)).toBe(false);
      expect(cloudflareWorkersAiBaseUrl(ACCOUNT)).toContain(ACCOUNT);
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
