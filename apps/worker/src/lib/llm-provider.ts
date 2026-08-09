// Env-side resolver for the worker's direct LLM provider, plus a re-export of
// the shared provider-agnostic client.
//
// The wire-level client (completeChat/coerceJsonObject/ResolvedLlm) now lives in
// `@bidstack/shared/llm` so the API can run the same call for the live "test
// provider" ping. This module keeps the worker-only ENV resolution path — a
// deployment-wide provider set via RFP_LLM_PROVIDER — which is the fallback when
// no per-org provider is configured. Per-org provider selection (the Settings
// UI) is resolved in `org-llm.ts` and takes precedence over env.
//
// Security: the API key is read from env and sent only in the provider request
// header. It is NEVER logged — callers log `${kind}:${model}`, never the key.

import {
  completeChat,
  coerceJsonObject,
  type ChatInput,
  type LlmProviderKind,
  type ResolvedLlm,
} from '@bidstack/shared/llm';

export { completeChat, coerceJsonObject };
export type { ChatInput, LlmProviderKind, ResolvedLlm };

function assertHostedProviderBaseUrl(
  rawBaseUrl: string | undefined,
  fallback: string,
  opts: { provider: string; allowedHosts: string[]; allowCustom?: boolean },
): string {
  const candidate = (rawBaseUrl ?? fallback).replace(/\/$/, '');
  const url = new URL(candidate);
  const hostname = url.hostname.toLowerCase();
  const isAllowedHost = opts.allowedHosts.includes(hostname);

  if (isAllowedHost) return candidate;

  if (!opts.allowCustom) {
    throw new Error(`${opts.provider} base URL host is not allowed`);
  }

  if (url.protocol !== 'https:') {
    throw new Error(`${opts.provider} custom base URL must use https`);
  }

  if (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    /^10\./.test(hostname) ||
    /^192\.168\./.test(hostname) ||
    /^169\.254\./.test(hostname) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(hostname)
  ) {
    throw new Error(`${opts.provider} custom base URL cannot be local or private`);
  }

  return candidate;
}

/**
 * Resolve the direct LLM provider from env. Returns null when RFP_LLM_PROVIDER
 * is unset/`dust` or the selected provider's API key is missing — in which case
 * the caller falls back to Dust, then to deterministic extraction.
 *
 * Model defaults are sensible but OVERRIDABLE via the matching *_MODEL env var
 * (model availability changes over time — set the one your account has).
 *
 *   RFP_LLM_PROVIDER=openai     OPENAI_API_KEY=…     [OPENAI_MODEL, OPENAI_BASE_URL]
 *   RFP_LLM_PROVIDER=anthropic  ANTHROPIC_API_KEY=…  [ANTHROPIC_MODEL, ANTHROPIC_BASE_URL]
 *   RFP_LLM_PROVIDER=moonshot   MOONSHOT_API_KEY=…   [MOONSHOT_MODEL, MOONSHOT_BASE_URL]   (Kimi; alias: RFP_LLM_PROVIDER=kimi)
  *   RFP_LLM_PROVIDER=nim        NVIDIA_NIM_API_KEY [NVIDIA_NIM_MODEL, NVIDIA_NIM_BASE_URL]
  *   RFP_LLM_PROVIDER=gemma      (no key for local)   [GEMMA_MODEL, GEMMA_BASE_URL, GEMMA_API_KEY]
 *     • local (default): open-weights Gemma via Ollama/vLLM/LM Studio at
 *       http://localhost:11434/v1, keyless — on-prem & private (best for NDA-Tier-D RFPs).
 *     • hosted: point GEMMA_BASE_URL at an OpenAI-compatible gateway
 *       (Vertex AI / OpenRouter / Groq / Together) + set GEMMA_API_KEY.
 *   RFP_LLM_PROVIDER=omniroute  (no key — free gateway) [OMNIROUTE_MODEL, OMNIROUTE_BASE_URL]
 *     • local OmniRoute gateway at http://localhost:20128/v1, model "auto"
 *       (OmniRoute itself picks/falls back across free providers). Keyless,
 *       same as gemma. Defaults SSE-streaming, so the resolver forces
 *       `stream: false` via extraBody to get a parseable chat.completion body.
 *   RFP_LLM_TIMEOUT_MS  per-call abort timeout (default 120000) — raise it for slow
 *     local inference so big drafts complete instead of failing open to a placeholder.
 */
export function resolveLlmFromEnv(env: NodeJS.ProcessEnv = process.env): ResolvedLlm | null {
  const kind = (env.RFP_LLM_PROVIDER ?? '').trim().toLowerCase();

  if (kind === 'openai' && env.OPENAI_API_KEY) {
    return {
      kind: 'openai',
      apiKey: env.OPENAI_API_KEY,
      model: env.OPENAI_MODEL ?? 'gpt-4o-mini',
      baseUrl: (env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/$/, ''),
    };
  }
  if (kind === 'anthropic' && env.ANTHROPIC_API_KEY) {
    return {
      kind: 'anthropic',
      apiKey: env.ANTHROPIC_API_KEY,
      model: env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-5',
      baseUrl: (env.ANTHROPIC_BASE_URL ?? 'https://api.anthropic.com').replace(/\/$/, ''),
    };
  }
  if ((kind === 'moonshot' || kind === 'kimi') && env.MOONSHOT_API_KEY) {
    return {
      kind: 'moonshot',
      apiKey: env.MOONSHOT_API_KEY,
      model: env.MOONSHOT_MODEL ?? 'moonshot-v1-32k',
      baseUrl: (env.MOONSHOT_BASE_URL ?? 'https://api.moonshot.ai/v1').replace(/\/$/, ''),
    };
  }
  if ((kind === 'nim' || kind === 'nvidia' || kind === 'nvidia-nim') && env.NVIDIA_NIM_API_KEY) {
    return {
      kind: 'nim',
      apiKey: env.NVIDIA_NIM_API_KEY,
      model: env.NVIDIA_NIM_MODEL ?? 'deepseek-ai/deepseek-v4-pro',
      baseUrl: assertHostedProviderBaseUrl(
        env.NVIDIA_NIM_BASE_URL,
        'https://integrate.api.nvidia.com/v1',
        {
          provider: 'NVIDIA NIM',
          allowedHosts: ['integrate.api.nvidia.com'],
          allowCustom: env.NVIDIA_NIM_ALLOW_CUSTOM_BASE_URL === 'true',
        },
      ),
      // DeepSeek V4 Pro on NVIDIA's hosted endpoint supports thinking mode.
      // Default it off for OpenAI-compatible text responses; allow opt-in.
      extraBody: {
        chat_template_kwargs: { thinking: env.NVIDIA_NIM_THINKING === 'true' },
      },
    };
  }
  // Gemma is open-weights, so unlike the others it resolves WITHOUT a key:
  // local servers (Ollama/vLLM/LM Studio) are keyless. Defaults to a local Ollama
  // endpoint; set GEMMA_BASE_URL (+ GEMMA_API_KEY) to use a hosted gateway instead.
  if (kind === 'gemma') {
    return {
      kind: 'gemma',
      apiKey: env.GEMMA_API_KEY ?? 'local', // placeholder — local servers ignore the bearer token
      model: env.GEMMA_MODEL ?? 'gemma3',
      baseUrl: (env.GEMMA_BASE_URL ?? 'http://localhost:11434/v1').replace(/\/$/, ''),
    };
  }
  // OmniRoute is a keyless local gateway (same posture as gemma) that speaks
  // the OpenAI-compatible /chat/completions shape, so its wire kind is
  // 'openai'. It defaults to SSE streaming; extraBody.stream=false forces the
  // non-streaming JSON body completeChat expects (see @bidstack/shared/llm).
  // NOT run through assertHostedProviderBaseUrl — localhost is the intended
  // target, not an accidental SSRF-prone override.
  if (kind === 'omniroute') {
    return {
      kind: 'openai',
      apiKey: 'omniroute', // placeholder — OmniRoute is keyless for free providers
      model: env.OMNIROUTE_MODEL ?? 'auto',
      baseUrl: (env.OMNIROUTE_BASE_URL ?? 'http://localhost:20128/v1').replace(/\/$/, ''),
      extraBody: { stream: false },
    };
  }
  return null;
}
