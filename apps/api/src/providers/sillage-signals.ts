// Sillage buying-intent signals -- MCP-first, REST-fallback external signal
// provider. Sillage is a B2B GTM buying-intent-signals platform: give it a
// target account (company name + domain) and it returns prioritized signals
// -- hiring/job-changes, past-champion or executive job changes, competitor
// engagement, funding, org moves, and social/news activity. This is NOT a
// text-classification service; there is no free-text input. Mirrors
// company-seamless-enrichment.ts: platform-level credentials (ENV only, one
// Sillage config per deployment, not per-org BYO -- see env.ts), never
// throws to the caller. Output is mapped straight into the shared Trigger
// shape (packages/shared/src/schemas/intel.ts) so it plugs into the
// account/opportunity intel UI (IntelCards.tsx TriggersCard) without a
// translation layer.
//
// MCP is preferred (SILLAGE_MCP_URL set); REST is the fallback (SILLAGE_API_KEY
// set, tried only when MCP is unset or MCP itself throws). Both fetch paths
// default to createSafeFetch() (SSRF-safe -- re-resolves DNS per request since
// the URLs are config-driven, not fixed literals). Tests override fetchImpl
// with a fake fetch.

import { createSafeFetch, type FetchLike } from '@bidstack/shared/server';
import { Trigger } from '@bidstack/shared';

const DEFAULT_BASE_URL = 'https://api.getsillage.com';
const DEFAULT_MCP_TOOL = 'account_signals';
// Single const so the exact REST path is a one-line change once Sillage
// publishes real API docs -- every other function here is shape-agnostic.
const REST_SIGNALS_PATH = '/v1/accounts/signals';
const TIMEOUT_MS = 12_000;
const MCP_PROTOCOL_VERSION = '2025-06-18';

export interface SillageAccountSignalsResult {
  signals: Trigger[];
  intentScore: number | null;
  source: 'mcp' | 'rest' | null;
  raw?: unknown;
  error?: string;
}

interface SillageLogger {
  warn: (obj: Record<string, unknown>, msg?: string) => void;
}

interface SillageAccountTarget {
  companyName?: string;
  domain?: string;
  accountId?: string;
}

interface FetchSillageAccountSignalsInput extends SillageAccountTarget {
  apiKey?: string;
  baseUrl?: string;
  mcpUrl?: string;
  mcpBearerToken?: string;
  mcpTool?: string;
  mcpTimeoutMs?: number;
  fetchImpl?: FetchLike;
  logger?: SillageLogger;
  now?: Date;
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
 * Find the array of raw signal rows inside an unpredictable vendor payload.
 * Only recurses into a key that is actually present -- recursing into a
 * missing (undefined) key would call this function with the same `undefined`
 * argument forever, overflowing the stack.
 */
function rowsFromUnknown(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.map(record).filter((row) => Object.keys(row).length > 0);
  const root = record(value);
  for (const key of ['signals', 'data', 'results', 'items']) {
    if (root[key] === undefined) continue;
    const rows = rowsFromUnknown(root[key]);
    if (rows.length > 0) return rows;
  }
  return [];
}

/** Coerce a 0-1 or 0-100 external priority scale into the shared Trigger 0-10 weight. */
function toWeight(raw: number | undefined): number {
  // No priority on the row -- assume moderate rather than fabricating
  // certainty in either direction.
  if (raw === undefined || !Number.isFinite(raw)) return 5;
  const hundredScale = raw > 1 ? raw : raw * 100;
  return Math.max(0, Math.min(10, hundredScale / 10));
}

/** Coerce a 0-1 or 0-100 external scale into a 0-100 account-level intent score. */
function toIntentScore(raw: number | undefined): number | null {
  if (raw === undefined || !Number.isFinite(raw)) return null;
  const hundredScale = raw > 1 ? raw : raw * 100;
  return Math.max(0, Math.min(100, hundredScale));
}

// Sillage's published signal categories (getsillage.com): hiring /
// job-changes, past-champion or executive job changes, competitor
// engagement, funding, org moves, and social/news activity. Anything
// unrecognized maps to 'other' rather than guessing.
function categoryToTriggerKind(category: string | undefined): Trigger['kind'] {
  const c = (category ?? '').toLowerCase();
  if (/hiring|headcount|job.?opening/.test(c)) return 'hiring';
  if (/champion|exec|leadership|job.?change/.test(c)) return 'executive_move';
  if (/competitor/.test(c)) return 'deal_activity';
  if (/fund|invest/.test(c)) return 'funding';
  if (/social|news|press/.test(c)) return 'press';
  return 'other';
}

function toIsoOrNow(raw: string | undefined, now: Date): string {
  if (!raw) return now.toISOString();
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? now.toISOString() : parsed.toISOString();
}

/**
 * Map one raw Sillage signal row into the shared Trigger shape, then
 * safeParse it -- an unexpected shape from the vendor drops the signal
 * instead of corrupting the intel feed with a malformed Trigger.
 */
function toTrigger(row: Record<string, unknown>, index: number, now: Date): Trigger | null {
  const label = firstString(row, ['label', 'title', 'headline', 'text', 'summary', 'description']);
  if (!label) return null;
  const category = firstString(row, ['kind', 'category', 'type', 'signalType', 'signal_type']);
  const id = firstString(row, ['id', 'signalId', 'signal_id', 'uuid']) ?? `sillage:${category ?? 'other'}:${index}`;
  const priority = firstNumber(row, ['priority', 'priorityScore', 'score', 'weight']);
  const observed = firstString(row, [
    'observedAt',
    'timestamp',
    'date',
    'detectedAt',
    'occurredAt',
    'publishedAt',
  ]);

  const candidate = {
    id,
    kind: categoryToTriggerKind(category),
    label,
    weight: toWeight(priority),
    observedAt: toIsoOrNow(observed, now),
    source: 'sillage',
  };
  const parsed = Trigger.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

function mapSignalsPayload(raw: unknown, now: Date): { signals: Trigger[]; intentScore: number | null } {
  const root = record(raw);
  const intentScore = toIntentScore(
    firstNumber(root, ['intentScore', 'accountScore', 'overallScore', 'priorityScore', 'score']),
  );
  const signals = rowsFromUnknown(raw)
    .map((row, index) => toTrigger(row, index, now))
    .filter((t): t is Trigger => t !== null);
  return { signals, intentScore };
}

/**
 * Fetch buying-intent signals for a target account via Sillage. Always
 * resolves (never throws) to a structured result: { signals: [], source:
 * null, error } when nothing is configured, the service is unreachable, or
 * the response can't be interpreted.
 */
export async function fetchSillageAccountSignals({
  companyName,
  domain,
  accountId,
  apiKey = process.env.SILLAGE_API_KEY,
  baseUrl = process.env.SILLAGE_API_BASE_URL || DEFAULT_BASE_URL,
  mcpUrl = process.env.SILLAGE_MCP_URL,
  mcpBearerToken = process.env.SILLAGE_MCP_BEARER_TOKEN,
  mcpTool = process.env.SILLAGE_MCP_SIGNALS_TOOL || DEFAULT_MCP_TOOL,
  mcpTimeoutMs = Number(process.env.SILLAGE_MCP_TIMEOUT_MS ?? TIMEOUT_MS),
  fetchImpl = createSafeFetch(),
  logger,
  now = new Date(),
}: FetchSillageAccountSignalsInput): Promise<SillageAccountSignalsResult> {
  const company = companyName?.trim();
  const site = domain?.trim();
  if (!company && !site) {
    return { signals: [], intentScore: null, source: null, error: 'companyName or domain is required' };
  }
  const target: SillageAccountTarget = { companyName: company, domain: site, accountId };

  if (mcpUrl) {
    try {
      const raw = await fetchSillageMcpSignals({ mcpUrl, mcpBearerToken, mcpTool, mcpTimeoutMs, target, fetchImpl });
      return { ...mapSignalsPayload(raw, now), source: 'mcp', raw };
    } catch (err) {
      logger?.warn({ err: errorMessage(err) }, 'Sillage MCP account-signals lookup failed; falling back to REST');
    }
  }

  if (!apiKey) {
    return {
      signals: [],
      intentScore: null,
      source: null,
      error: mcpUrl
        ? 'Sillage MCP failed and no SILLAGE_API_KEY fallback is configured'
        : 'Sillage is not configured (set SILLAGE_API_KEY or SILLAGE_MCP_URL)',
    };
  }

  try {
    const raw = await fetchSillageRestSignals({ baseUrl, apiKey, target, fetchImpl });
    return { ...mapSignalsPayload(raw, now), source: 'rest', raw };
  } catch (err) {
    logger?.warn({ err: errorMessage(err) }, 'Sillage REST account-signals lookup failed');
    return { signals: [], intentScore: null, source: null, error: errorMessage(err) };
  }
}

async function fetchSillageRestSignals({
  baseUrl,
  apiKey,
  target,
  fetchImpl,
}: {
  baseUrl: string;
  apiKey: string;
  target: SillageAccountTarget;
  fetchImpl: FetchLike;
}): Promise<unknown> {
  const res = await fetchImpl(`${baseUrl.replace(/\/+$/, '')}${REST_SIGNALS_PATH}`, {
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify(target),
  });
  if (!res.ok) throw new Error(`Sillage REST HTTP ${res.status}`);
  return res.json();
}

async function fetchSillageMcpSignals({
  mcpUrl,
  mcpBearerToken,
  mcpTool,
  mcpTimeoutMs,
  target,
  fetchImpl,
}: {
  mcpUrl: string;
  mcpBearerToken?: string;
  mcpTool: string;
  mcpTimeoutMs: number;
  target: SillageAccountTarget;
  fetchImpl: FetchLike;
}): Promise<unknown> {
  const client = new SillageMcpClient({ url: mcpUrl, bearerToken: mcpBearerToken, timeoutMs: mcpTimeoutMs, fetchImpl });
  return client.callTool(mcpTool, { ...target });
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
