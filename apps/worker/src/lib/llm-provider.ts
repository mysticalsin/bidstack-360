// Multi-provider LLM client for the RFP pipeline.
//
// Lets a deployment run RFP AI steps on a direct chat-completion provider —
// OpenAI (GPT), Anthropic (Claude), or Moonshot (Kimi) — instead of (or
// alongside) a Dust workspace. Selection is per-deployment via env so it works
// immediately without a schema migration; the existing per-org Dust path is
// unchanged and remains the fallback. Per-org provider config via the Settings
// UI (mirroring the Dust IntegrationConfig pattern) is a follow-up.
//
// Security: the API key is read from env and sent only in the provider request
// header. It is NEVER logged — callers log `${kind}:${model}`, never the key.
//
// Dependency-free on purpose: uses global fetch (Node 18+) so we don't pull the
// OpenAI / Anthropic SDKs into the worker bundle. OpenAI and Moonshot share the
// OpenAI-compatible /chat/completions shape; Anthropic uses /v1/messages.

export type LlmProviderKind = 'openai' | 'anthropic' | 'moonshot' | 'gemma';

export interface ResolvedLlm {
  kind: LlmProviderKind;
  apiKey: string;
  model: string;
  baseUrl: string;
}

export interface ChatInput {
  system?: string;
  user: string;
  maxTokens?: number;
  /** Force JSON (OpenAI-compatible providers: OpenAI/Moonshot/Gemma). Omit for Markdown/prose steps. */
  responseFormat?: 'json_object' | 'text';
  /** Per-call abort timeout in ms (default 120s). */
  timeoutMs?: number;
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
 *   RFP_LLM_PROVIDER=gemma      (no key for local)   [GEMMA_MODEL, GEMMA_BASE_URL, GEMMA_API_KEY]
 *     • local (default): open-weights Gemma via Ollama/vLLM/LM Studio at
 *       http://localhost:11434/v1, keyless — on-prem & private (best for NDA-Tier-D RFPs).
 *     • hosted: point GEMMA_BASE_URL at an OpenAI-compatible gateway
 *       (Vertex AI / OpenRouter / Groq / Together) + set GEMMA_API_KEY.
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
  return null;
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
  // slot forever (BullMQ keeps renewing the lock while we await fetch, so the job
  // is never declared stalled). On timeout fetch throws → caller's fail-open path.
  // 120s default suits fast hosted APIs; raise RFP_LLM_TIMEOUT_MS for slow LOCAL
  // inference (a full Markdown section on local Gemma can exceed 120s and would
  // otherwise fail-open to a placeholder).
  const defaultTimeoutMs = Number(process.env.RFP_LLM_TIMEOUT_MS) || 120_000;
  const signal = AbortSignal.timeout(input.timeoutMs ?? defaultTimeoutMs);
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

  // openai + moonshot: OpenAI-compatible /chat/completions.
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
      // Only force JSON when the caller asks. Markdown steps (section-draft,
      // review crew) must NOT get json_object — it makes the model emit JSON (or
      // 400) and the step silently degrades to a placeholder.
      ...(input.responseFormat === 'json_object'
        ? { response_format: { type: 'json_object' as const } }
        : {}),
    }),
  });
  if (!res.ok) {
    throw new Error(`${llm.kind} completion failed: HTTP ${res.status}`);
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return data.choices?.[0]?.message?.content ?? '';
}
