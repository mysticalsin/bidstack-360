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

export type LlmProviderKind = 'openai' | 'anthropic' | 'moonshot';

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
  if (llm.kind === 'anthropic') {
    const res = await fetch(`${llm.baseUrl}/v1/messages`, {
      method: 'POST',
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
      response_format: { type: 'json_object' },
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
