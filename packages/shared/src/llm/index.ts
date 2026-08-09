// Provider-agnostic LLM client — the single wire-level implementation shared by
// the worker (RFP + contract extraction execution) and the API (the live
// "test this provider" ping in Settings → Integrations).
//
// WHY shared: vendor-independence means ONE place understands every provider's
// request shape. A new provider (or a fix to the Anthropic vs OpenAI-compatible
// split) is wired once and both the executor and the connectivity test inherit
// it. Reached only via the '@bidstack/shared/llm' subpath — it uses global fetch
// and must NEVER be pulled into the web bundle.
//
// Security: the API key travels only in the provider request header. It is NEVER
// logged — callers log `${kind}:${model}`, never the key.
//
// Dependency-free on purpose: global fetch (Node 18+), so we don't drag the
// OpenAI / Anthropic SDKs into either bundle. OpenAI, Moonshot (Kimi), NVIDIA
// NIM, Gemma, and OmniRoute share the OpenAI-compatible /chat/completions shape;
// Anthropic uses /v1/messages.

/** Wire-level provider families. */
export type LlmProviderKind = 'openai' | 'anthropic' | 'moonshot' | 'nim' | 'gemma';

/**
 * Provider ids exposed in the Settings UI / stored per-org. These are the
 * brand-facing names; {@link DIRECT_PROVIDER_TO_KIND} maps them to the wire
 * family above. Kept in sync with `DIRECT_AGENT_PROVIDERS` in the API lib.
 */
export type DirectAgentProviderId =
  | 'claude'
  | 'openai'
  | 'omniroute'
  | 'kimi'
  | 'nvidia_nim'
  | 'gemma';

export const DIRECT_PROVIDER_TO_KIND: Record<DirectAgentProviderId, LlmProviderKind> = {
  claude: 'anthropic',
  openai: 'openai',
  // OmniRoute speaks the OpenAI-compatible /chat/completions wire shape (it
  // is a local gateway, not OpenAI itself — see DIRECT_PROVIDER_OVERRIDES for
  // its own baseUrl/model/apiKey/extraBody so it doesn't inherit OpenAI's).
  omniroute: 'openai',
  kimi: 'moonshot',
  nvidia_nim: 'nim',
  gemma: 'gemma',
};

/** Every brand-facing provider id, in display order. */
export const DIRECT_AGENT_PROVIDERS = [
  'claude',
  'openai',
  'omniroute',
  'kimi',
  'nvidia_nim',
  'gemma',
] as const satisfies readonly DirectAgentProviderId[];

export function isDirectAgentProvider(value: string): value is DirectAgentProviderId {
  return (DIRECT_AGENT_PROVIDERS as readonly string[]).includes(value);
}

// ── integration_configs storage keys (shared by API writes + worker reads) ──
// Per-org provider keys + the active-provider selector live as rows in the
// `integration_configs` table under the `dust` type. The API lib re-exports
// these for back-compat; the worker reads them directly. They MUST stay in sync.
export const AGENT_PROVIDER_CONFIG_TYPE = 'dust';
export const AGENT_PROVIDER_CREDENTIAL_PREFIX = 'agent-provider:';
/** Selector row whose config.provider names the org's active default provider. */
export const AGENT_PROVIDER_ACTIVE_NAME = `${AGENT_PROVIDER_CREDENTIAL_PREFIX}__active__`;

export function agentProviderCredentialName(provider: DirectAgentProviderId): string {
  return `${AGENT_PROVIDER_CREDENTIAL_PREFIX}${provider}`;
}

/** Sensible per-family defaults; every field is OVERRIDABLE by org/env config. */
export const PROVIDER_DEFAULTS: Record<LlmProviderKind, { baseUrl: string; model: string }> = {
  anthropic: { baseUrl: 'https://api.anthropic.com', model: 'claude-sonnet-4-5' },
  openai: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  moonshot: { baseUrl: 'https://api.moonshot.ai/v1', model: 'moonshot-v1-32k' },
  nim: { baseUrl: 'https://integrate.api.nvidia.com/v1', model: 'deepseek-ai/deepseek-v4-pro' },
  gemma: { baseUrl: 'http://localhost:11434/v1', model: 'gemma3' },
};

/**
 * Per-provider-id overrides, consulted BEFORE {@link PROVIDER_DEFAULTS}.
 * WHY: PROVIDER_DEFAULTS is keyed by wire *kind*, and omniroute shares the
 * 'openai' kind (same /chat/completions shape) without being OpenAI itself —
 * without this it would wrongly inherit api.openai.com + gpt-4o-mini. Also
 * carries the keyless placeholder apiKey (mirrors gemma) and the extraBody
 * OmniRoute needs: it defaults to SSE streaming, so `stream: false` is
 * required to get a parseable chat.completion JSON body instead of an
 * event-stream completeChat can't read.
 */
const DIRECT_PROVIDER_OVERRIDES: Partial<
  Record<
    DirectAgentProviderId,
    { baseUrl: string; model: string; apiKey: string; extraBody?: Record<string, unknown> }
  >
> = {
  omniroute: {
    baseUrl: 'http://localhost:20128/v1',
    // 'auto/best-free' routes to reliable free-tier models (e.g. deepseek-v4-flash-free);
    // bare 'auto' can land on a degenerate keyless provider that returns near-empty
    // content. Override per-org via Settings or OMNIROUTE_MODEL if you add paid keys.
    model: 'auto/best-free',
    apiKey: 'omniroute',
    extraBody: { stream: false },
  },
};

export interface ResolvedLlm {
  kind: LlmProviderKind;
  apiKey: string;
  model: string;
  baseUrl: string;
  /** Extra OpenAI-compatible payload fields, provider-specific and never logged. */
  extraBody?: Record<string, unknown>;
}

export interface ChatInput {
  system?: string;
  user: string;
  maxTokens?: number;
  /** Force JSON (OpenAI-compatible providers: OpenAI/OmniRoute/Moonshot/NIM/Gemma). Omit for prose. */
  responseFormat?: 'json_object' | 'text';
  /** Per-call abort timeout in ms (default 120s). */
  timeoutMs?: number;
  /** Cooperative cancellation from queue-backed jobs. */
  signal?: AbortSignal;
}

/**
 * Build a {@link ResolvedLlm} from stored (org) or runtime config. Maps the
 * brand-facing provider id to its wire family and fills missing model/baseUrl
 * from {@link DIRECT_PROVIDER_OVERRIDES} (checked first) or {@link PROVIDER_DEFAULTS}.
 * The Anthropic base is normalised so callers can paste either
 * `https://api.anthropic.com` or the full `/v1/messages` URL.
 */
export function buildResolvedLlm(input: {
  provider: DirectAgentProviderId;
  apiKey?: string;
  model?: string;
  baseUrl?: string;
}): ResolvedLlm {
  const kind = DIRECT_PROVIDER_TO_KIND[input.provider];
  const providerOverride = DIRECT_PROVIDER_OVERRIDES[input.provider];
  const defaults = providerOverride ?? PROVIDER_DEFAULTS[kind];
  let baseUrl = (input.baseUrl ?? defaults.baseUrl).replace(/\/+$/, '');
  // Anthropic's path is appended by completeChat; accept a pasted /v1/messages.
  if (kind === 'anthropic') baseUrl = baseUrl.replace(/\/v1\/messages$/, '');
  return {
    kind,
    // Gemma and OmniRoute are keyless local servers; a placeholder keeps the
    // header well-formed without requiring a key.
    apiKey: input.apiKey ?? providerOverride?.apiKey ?? (kind === 'gemma' ? 'local' : ''),
    model: input.model ?? defaults.model,
    baseUrl,
    extraBody: providerOverride?.extraBody,
  };
}

function withTimeoutSignal(
  timeoutMs: number,
  external?: AbortSignal,
): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const abortFromExternal = () => controller.abort(external?.reason);

  if (external?.aborted) {
    abortFromExternal();
  } else {
    external?.addEventListener('abort', abortFromExternal, { once: true });
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timeout);
      external?.removeEventListener('abort', abortFromExternal);
    },
  };
}

/**
 * Pull a JSON object out of a model response that may be wrapped in markdown
 * fences or surrounded by prose (common with Anthropic). Returns the original
 * string if no object is found so the caller's JSON.parse fails loudly.
 */
export function coerceJsonObject(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = (fenced?.[1] ?? raw).trim();
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  return start >= 0 && end > start ? body.slice(start, end + 1) : body;
}

/** Provider-agnostic chat completion. Returns the assistant text (possibly JSON). */
export async function completeChat(llm: ResolvedLlm, input: ChatInput): Promise<string> {
  const maxTokens = input.maxTokens ?? 4096;
  // Bound every provider call: a hung provider must not pin a worker concurrency
  // slot forever. On timeout fetch throws → caller's fail-open path. 120s default
  // suits fast hosted APIs; raise input.timeoutMs for slow LOCAL inference.
  const defaultTimeoutMs = Number(process.env.RFP_LLM_TIMEOUT_MS) || 120_000;
  const { signal, cleanup } = withTimeoutSignal(input.timeoutMs ?? defaultTimeoutMs, input.signal);
  try {
    if (llm.kind === 'anthropic') {
      const res = await fetch(`${llm.baseUrl}/v1/messages`, {
        method: 'POST',
        signal,
        headers: {
          'content-type': 'application/json',
          'x-api-key': llm.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: llm.model,
          max_tokens: maxTokens,
          ...(input.system ? { system: input.system } : {}),
          messages: [{ role: 'user', content: input.user }],
        }),
      });
      if (!res.ok) {
        throw new Error(`anthropic completion failed: HTTP ${res.status}`);
      }
      const data = (await res.json()) as { content?: Array<{ text?: string }> };
      return data.content?.[0]?.text ?? '';
    }

    // OpenAI-compatible /chat/completions providers.
    const res = await fetch(`${llm.baseUrl}/chat/completions`, {
      method: 'POST',
      signal,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${llm.apiKey}`,
      },
      body: JSON.stringify({
        model: llm.model,
        messages: [
          ...(input.system ? [{ role: 'system', content: input.system }] : []),
          { role: 'user', content: input.user },
        ],
        max_tokens: maxTokens,
        temperature: 0.2,
        // Only force JSON when the caller asks. Markdown steps must NOT get
        // json_object — it makes the model emit JSON (or 400) and silently degrade.
        ...(input.responseFormat === 'json_object'
          ? { response_format: { type: 'json_object' as const } }
          : {}),
        ...(llm.extraBody ?? {}),
      }),
    });
    if (res.status !== 200) {
      throw new Error(`${llm.kind} completion failed: HTTP ${res.status}`);
    }
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content ?? '';
    if (!content.trim()) {
      throw new Error(`${llm.kind} completion returned empty content`);
    }
    return content;
  } finally {
    cleanup();
  }
}
