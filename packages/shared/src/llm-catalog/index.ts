// Provider catalogue — pure data and pure functions, NO network client.
//
// WHY this is a separate module from `@bidstack/shared/llm`: that module owns
// the wire client (global fetch) and carries a hard rule that it must never be
// pulled into the web bundle. But the browser legitimately needs the same
// provider facts — model ids, context windows, how a Cloudflare account id
// becomes a base URL — to render a picker that agrees with what the server
// will accept. Keeping the data here (exported from the main barrel) lets both
// sides import one source of truth without shipping the client to the browser.
// `llm/index.ts` re-exports everything below for server callers.

// ── Provider registry ──────────────────────────────────────────────────────
// The brand-facing provider ids and their wire families. Pure data, so the web
// bundle can render a provider picker that agrees with the server without
// importing the fetch client.

/** Wire-level provider families. */
export type LlmProviderKind = 'openai' | 'anthropic' | 'moonshot' | 'nim' | 'gemma';

/**
 * Provider ids exposed in the Settings UI / stored per-org. These are the
 * brand-facing names; {@link DIRECT_PROVIDER_TO_KIND} maps them to the wire
 * family above.
 */
export type DirectAgentProviderId =
  | 'claude'
  | 'openai'
  | 'cloudflare'
  | 'omniroute'
  | 'kimi'
  | 'nvidia_nim'
  | 'gemma';

export const DIRECT_PROVIDER_TO_KIND: Record<DirectAgentProviderId, LlmProviderKind> = {
  claude: 'anthropic',
  openai: 'openai',
  // Cloudflare Workers AI exposes an OpenAI-compatible /chat/completions (and
  // supports response_format), so it rides the 'openai' wire kind. Its base URL
  // embeds the account id — see cloudflareWorkersAiBaseUrl.
  cloudflare: 'openai',
  // OmniRoute speaks the OpenAI-compatible /chat/completions wire shape (it is
  // a local gateway, not OpenAI itself — see DIRECT_PROVIDER_OVERRIDES for its
  // own baseUrl/model/apiKey/extraBody so it doesn't inherit OpenAI's).
  omniroute: 'openai',
  kimi: 'moonshot',
  nvidia_nim: 'nim',
  gemma: 'gemma',
};

/** Every brand-facing provider id, in display order. */
export const DIRECT_AGENT_PROVIDERS = [
  'claude',
  'openai',
  'cloudflare',
  'omniroute',
  'kimi',
  'nvidia_nim',
  'gemma',
] as const satisfies readonly DirectAgentProviderId[];

export function isDirectAgentProvider(value: string): value is DirectAgentProviderId {
  return (DIRECT_AGENT_PROVIDERS as readonly string[]).includes(value);
}

/** Cloudflare account ids are 32 lowercase hex characters. */
const CLOUDFLARE_ACCOUNT_ID_RE = /^[0-9a-f]{32}$/i;

export const CLOUDFLARE_API_HOST = 'api.cloudflare.com';
/** AI Gateway host — an operator may route through it for logging/caching. */
export const CLOUDFLARE_GATEWAY_HOST = 'gateway.ai.cloudflare.com';

/** The OpenAI-compatible Workers AI base URL for an account. */
export function cloudflareWorkersAiBaseUrl(accountId: string): string {
  return `https://${CLOUDFLARE_API_HOST}/client/v4/accounts/${accountId.trim()}/ai/v1`;
}

export function isCloudflareAccountId(value: string): boolean {
  return CLOUDFLARE_ACCOUNT_ID_RE.test(value.trim());
}

/**
 * Accept a bare account id OR a full base URL and return a usable base URL.
 * Returns null when the input is neither, so callers can fail loudly instead
 * of firing a request at a malformed host.
 */
export function normalizeCloudflareBaseUrl(input: string | undefined): string | null {
  const raw = input?.trim();
  if (!raw) return null;
  if (isCloudflareAccountId(raw)) return cloudflareWorkersAiBaseUrl(raw);
  if (!/^https?:\/\//i.test(raw)) return null;
  return raw.replace(/\/+$/, '');
}

export interface CloudflareModelInfo {
  /** The `@cf/...` id sent as `model`. */
  id: string;
  label: string;
  /** Max context in tokens, from the Cloudflare model catalogue. */
  contextTokens: number;
  note: string;
  /**
   * Emits a chain-of-thought into `message.reasoning` BEFORE `message.content`.
   * Measured consequence, not a label: with a small `max_tokens` the whole
   * budget goes to the reasoning trace and `content` comes back **null**, which
   * completeChat treats as "returned empty content". Verified against the live
   * Workers AI endpoint on 2026-08-17 — glm-4.7-flash returned null content at
   * max_tokens=16 (the connectivity probe's budget) and answered normally at
   * 512. Never make one of these the default.
   */
  reasoning?: boolean;
}

/**
 * Curated Workers AI text-generation models, most-capable first. A picker beats
 * a free-text field here: the ids are long and `@cf/`-prefixed (easy to typo
 * into a 400), and the context window is the number that actually decides
 * whether Polo's payloads fit.
 *
 * Context matters concretely: document-extract.ts sends up to 80,000 CHARACTERS
 * in one prompt (~20–27k tokens), which does NOT fit llama-3.3-70b's 24,000
 * token window. That is why the default is a 131k-context model and not
 * Cloudflare's headline Llama.
 */
export const CLOUDFLARE_WORKERS_AI_MODELS: readonly CloudflareModelInfo[] = [
  {
    id: '@cf/meta/llama-4-scout-17b-16e-instruct',
    label: 'Llama 4 Scout 17B (Meta)',
    contextTokens: 131_000,
    note: 'Recommended. 131k context, ~1s, clean JSON, no reasoning preamble.',
  },
  {
    id: '@cf/meta/llama-3.1-8b-instruct-fast',
    label: 'Llama 3.1 8B Fast (Meta)',
    contextTokens: 60_000,
    note: 'Fastest and cheapest (~0.5s). Good for short copilot calls.',
  },
  {
    id: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
    label: 'Llama 3.3 70B Fast (Meta)',
    contextTokens: 24_000,
    note: 'Strong quality, but the smallest context — a long RFP extraction will not fit.',
  },
  {
    id: '@cf/zai-org/glm-4.7-flash',
    label: 'GLM 4.7 Flash (Zhipu AI)',
    contextTokens: 131_072,
    note: 'Reasoning model. Give it room — it returns nothing useful on short replies.',
    reasoning: true,
  },
  {
    id: '@cf/nvidia/nemotron-3-120b-a12b',
    label: 'Nemotron 3 120B (NVIDIA)',
    contextTokens: 131_072,
    note: 'Reasoning model, agentic-tuned. Give it room.',
    reasoning: true,
  },
  {
    id: '@cf/qwen/qwen3-30b-a3b-fp8',
    label: 'Qwen3 30B A3B (Alibaba)',
    contextTokens: 32_000,
    note: 'Reasoning model, strong multilingual. Give it room.',
    reasoning: true,
  },
];

/**
 * Default: 131k context (Polo's extraction prompt runs to 80,000 characters)
 * AND non-reasoning, so it still answers a 16-token connectivity probe. Both
 * halves are load-bearing — see CloudflareModelInfo.reasoning.
 */
export const CLOUDFLARE_DEFAULT_MODEL = '@cf/meta/llama-4-scout-17b-16e-instruct';
