// Sillage intent detection — MCP-first, REST-fallback external signal provider.
// Mirrors company-seamless-enrichment.ts: platform-level credentials (ENV only,
// one Sillage config per deployment, not per-org BYO — see env.ts), never
// throws to the caller. Intent detection is a best-effort signal, so every
// path fails open to a structured null result on missing config, an
// unreachable service, or an unparseable payload.
//
// MCP is preferred (SILLAGE_MCP_URL set); REST is the fallback (SILLAGE_API_KEY
// set, tried only when MCP is unset or MCP itself throws). Both fetch paths
// default to createSafeFetch() (SSRF-safe — re-resolves DNS per request since
// the URLs are config-driven, not fixed literals). Tests override fetchImpl
// with a fake fetch.

import { createSafeFetch, type FetchLike } from '@bidstack/shared/server';

const DEFAULT_BASE_URL = 'https://api.sillage.ai';
const DEFAULT_MCP_TOOL = 'detect_intent';
const TIMEOUT_MS = 12_000;
const MCP_PROTOCOL_VERSION = '2025-06-18';

export interface SillageIntentResult {
  intent: string | null;
  confidence: number | null;
  source: 'mcp' | 'rest' | null;
  raw?: unknown;
  error?: string;
}

interface SillageLogger {
  warn: (obj: Record<string, unknown>, msg?: string) => void;
}

interface DetectSillageIntentInput {
  text: string;
  context?: Record<string, unknown>;
  apiKey?: string;
  baseUrl?: string;
  mcpUrl?: string;
  mcpBearerToken?: string;
  mcpTool?: string;
  mcpTimeoutMs?: number;
  fetchImpl?: FetchLike;
  logger?: SillageLogger;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function firstString(row: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function firstNumber(row: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = row[key];
    const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Sillage request failed';
}

/**
 * Coerce unpredictable external JSON into { intent, confidence }. Never
 * throws — an unexpected shape (string, array, missing fields) just yields
 * nulls so the caller can fail open instead of crashing on a vendor payload
 * change. Only descends into a `data`/`result` envelope when that field is
 * itself an object — a flat `{ intent: 'x' }` response must NOT be
 * mistaken for an envelope key and unwrapped into nothing.
 */
function normalizeIntentPayload(raw: unknown): { intent: string | null; confidence: number | null } {
  const root = record(raw);
  const wrapper = root.data ?? root.result;
  const nested = wrapper && typeof wrapper === 'object' && !Array.isArray(wrapper) ? record(wrapper) : root;
  const intent =
    firstString(nested, ['intent', 'label', 'name', 'category', 'topIntent', 'top_intent']) ?? null;
  const confidenceRaw = firstNumber(nested, ['confidence', 'score', 'probability']);
  const confidence =
    confidenceRaw === undefined ? null : confidenceRaw > 1 ? Math.min(confidenceRaw / 100, 1) : confidenceRaw;
  return { intent, confidence };
}

/**
 * Detect intent via Sillage. Always resolves (never throws) to a structured
 * result: { intent: null, source: null, error } when nothing is configured,
 * the service is unreachable, or the response can't be interpreted.
 */
export async function detectSillageIntent({
  text,
  context,
  apiKey = process.env.SILLAGE_API_KEY,
  baseUrl = process.env.SILLAGE_API_BASE_URL || DEFAULT_BASE_URL,
  mcpUrl = process.env.SILLAGE_MCP_URL,
  mcpBearerToken = process.env.SILLAGE_MCP_BEARER_TOKEN,
  mcpTool = process.env.SILLAGE_MCP_INTENT_TOOL || DEFAULT_MCP_TOOL,
  mcpTimeoutMs = Number(process.env.SILLAGE_MCP_TIMEOUT_MS ?? TIMEOUT_MS),
  fetchImpl = createSafeFetch(),
  logger,
}: DetectSillageIntentInput): Promise<SillageIntentResult> {
  const trimmed = text.trim();
  if (!trimmed) return { intent: null, confidence: null, source: null, error: 'text is required' };

  if (mcpUrl) {
    try {
      const { intent, confidence, raw } = await fetchSillageMcpIntent({
        mcpUrl,
        mcpBearerToken,
        mcpTool,
        mcpTimeoutMs,
        text: trimmed,
        context,
        fetchImpl,
      });
      return { intent, confidence, source: 'mcp', raw };
    } catch (err) {
      logger?.warn({ err: errorMessage(err) }, 'Sillage MCP intent detection failed; falling back to REST');
    }
  }

  if (!apiKey) {
    return {
      intent: null,
      confidence: null,
      source: null,
      error: mcpUrl
        ? 'Sillage MCP failed and no SILLAGE_API_KEY fallback is configured'
        : 'Sillage is not configured (set SILLAGE_API_KEY or SILLAGE_MCP_URL)',
    };
  }

  try {
    const { intent, confidence, raw } = await fetchSillageRestIntent({
      baseUrl,
      apiKey,
      text: trimmed,
      context,
      fetchImpl,
    });
    return { intent, confidence, source: 'rest', raw };
  } catch (err) {
    logger?.warn({ err: errorMessage(err) }, 'Sillage REST intent detection failed');
    return { intent: null, confidence: null, source: null, error: errorMessage(err) };
  }
}

async function fetchSillageRestIntent({
  baseUrl,
  apiKey,
  text,
  context,
  fetchImpl,
}: {
  baseUrl: string;
  apiKey: string;
  text: string;
  context?: Record<string, unknown>;
  fetchImpl: FetchLike;
}): Promise<{ intent: string | null; confidence: number | null; raw: unknown }> {
  const res = await fetchImpl(`${baseUrl.replace(/\/+$/, '')}/v1/intent`, {
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({ text, context: context ?? {} }),
  });
  if (!res.ok) throw new Error(`Sillage REST HTTP ${res.status}`);
  const json = (await res.json()) as unknown;
  return { ...normalizeIntentPayload(json), raw: json };
}

async function fetchSillageMcpIntent({
  mcpUrl,
  mcpBearerToken,
  mcpTool,
  mcpTimeoutMs,
  text,
  context,
  fetchImpl,
}: {
  mcpUrl: string;
  mcpBearerToken?: string;
  mcpTool: string;
  mcpTimeoutMs: number;
  text: string;
  context?: Record<string, unknown>;
  fetchImpl: FetchLike;
}): Promise<{ intent: string | null; confidence: number | null; raw: unknown }> {
  const client = new SillageMcpClient({ url: mcpUrl, bearerToken: mcpBearerToken, timeoutMs: mcpTimeoutMs, fetchImpl });
  const raw = await client.callTool(mcpTool, { text, context: context ?? {} });
  return { ...normalizeIntentPayload(raw), raw };
}

class SillageMcpClient {
  private sessionId: string | undefined;
  private initialized = false;
  private nextId = 1;

  constructor(
    private readonly options: {
      url: string;
      bearerToken?: string;
      timeoutMs: number;
      fetchImpl: FetchLike;
    },
  ) {}

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    const raw = await this.rpc('tools/call', { name, arguments: args });
    const result = record(raw);
    if (result.isError === true) throw new Error(`Sillage MCP tool ${name} failed`);
    if (result.structuredContent !== undefined) return result.structuredContent;
    const content = Array.isArray(result.content) ? result.content.map(record) : [];
    const text = firstString(content[0] ?? {}, ['text']);
    if (!text) return raw;
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return text;
    }
  }

  private async initialize(): Promise<void> {
    if (this.initialized) return;
    await this.rpc(
      'initialize',
      {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'bidstack-sillage-client', version: '0.1.0' },
      },
      { skipInit: true },
    );
    this.initialized = true;
    await this.notify('notifications/initialized').catch(() => undefined);
  }

  private async rpc(
    method: string,
    params: Record<string, unknown>,
    opts: { skipInit?: boolean } = {},
  ): Promise<unknown> {
    if (!opts.skipInit) await this.initialize();
    const response = await this.postJsonRpc({ jsonrpc: '2.0', id: this.nextId++, method, params });
    const envelope = record(response);
    const error = record(envelope.error);
    if (error.message) throw new Error(String(error.message));
    return envelope.result;
  }

  private async notify(method: string, params: Record<string, unknown> = {}): Promise<void> {
    await this.postJsonRpc({ jsonrpc: '2.0', method, params }, true);
  }

  private async postJsonRpc(body: Record<string, unknown>, notification = false): Promise<unknown> {
    const response = await this.options.fetchImpl(this.options.url, {
      method: 'POST',
      redirect: 'error',
      headers: this.headers(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.options.timeoutMs),
    });
    const sessionId = response.headers.get('Mcp-Session-Id') ?? response.headers.get('mcp-session-id');
    if (sessionId && !this.sessionId) this.sessionId = sessionId;
    if (notification && response.status === 202) return undefined;
    if (!response.ok) throw new Error(`sillage-mcp HTTP ${response.status}`);
    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('text/event-stream')) return readJsonFromEventStream(response);
    const text = await response.text();
    return text ? (JSON.parse(text) as unknown) : undefined;
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'MCP-Protocol-Version': MCP_PROTOCOL_VERSION,
    };
    if (this.options.bearerToken) headers.Authorization = `Bearer ${this.options.bearerToken}`;
    if (this.sessionId) headers['Mcp-Session-Id'] = this.sessionId;
    return headers;
  }
}

async function readJsonFromEventStream(response: Response): Promise<unknown> {
  const text = await response.text();
  const frames = text.split(/\n\n+/);
  for (const frame of frames.reverse()) {
    const dataLine = frame
      .split(/\n/)
      .map((line) => line.trim())
      .find((line) => line.startsWith('data:'));
    if (!dataLine) continue;
    const payload = dataLine.slice('data:'.length).trim();
    if (!payload) continue;
    return JSON.parse(payload) as unknown;
  }
  throw new Error('sillage-mcp returned an empty event stream');
}
