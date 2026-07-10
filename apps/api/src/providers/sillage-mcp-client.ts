// Minimal Streamable-HTTP MCP client for the Sillage connector. Split out of
// sillage-signals.ts so both files stay under the 400-line ceiling; the
// provider (sillage-signals.ts) is the only consumer besides its tests.
//
// Session lifecycle: clients are cached per config (getSillageMcpClient) so
// the negotiated protocol version + Mcp-Session-Id survive across lookups.
// Without reuse, every cache-miss lookup pays initialize +
// notifications/initialized + tools/call (3 sequential round trips) — which
// is what starved the 1.5s opportunity-page race in sillage-intel-augment.ts
// and left the Buying-triggers card silently empty.

import type { FetchLike } from '@bidstack/shared/server';

export const MCP_PROTOCOL_VERSION = '2025-06-18';

export interface SillageMcpClientOptions {
  url: string;
  bearerToken?: string;
  timeoutMs: number;
  fetchImpl: FetchLike;
}

// Local copy of sillage-signals.ts's record(): importing it back would create
// a provider <-> client cycle for three lines of code.
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** MCP spec: a request presenting an expired/unknown Mcp-Session-Id is
 * answered with a hard HTTP 404 — distinct from a tool-level failure. */
function isSessionExpired(err: unknown): boolean {
  return err instanceof Error && err.message === 'sillage-mcp HTTP 404';
}

export class SillageMcpClient {
  private sessionId: string | undefined;
  // Echoed on every post-initialize request. A server that negotiated an
  // OLDER version MUST 400 a client that keeps sending its own pinned
  // version, so this starts at the pinned const and is overwritten with
  // whatever the initialize result reports.
  private protocolVersion = MCP_PROTOCOL_VERSION;
  private initPromise: Promise<void> | undefined;
  private nextId = 1;

  constructor(private readonly options: SillageMcpClientOptions) {}

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    try {
      return await this.callToolOnce(name, args);
    } catch (err) {
      if (!isSessionExpired(err)) throw err;
      // Server-side session expiry on a long-lived cached client: drop the
      // dead session, re-initialize once, retry once. Anything after that is
      // a real failure and propagates to the provider's fallback logic.
      this.reset();
      return this.callToolOnce(name, args);
    }
  }

  /** Run only the initialize handshake — used by the health probe to prove a
   * NEW session can be opened without spending a tools/call. */
  async initialize(): Promise<void> {
    // Memoized so concurrent callers share one handshake; cleared on failure
    // so the next caller retries instead of inheriting a rejected promise.
    this.initPromise ??= this.doInitialize().catch((err: unknown) => {
      this.initPromise = undefined;
      throw err;
    });
    return this.initPromise;
  }

  private async callToolOnce(name: string, args: Record<string, unknown>): Promise<unknown> {
    const raw = await this.rpc('tools/call', { name, arguments: args });
    const result = record(raw);
    if (result.isError === true) throw new Error(`Sillage MCP tool ${name} failed`);
    if (result.structuredContent !== undefined) return result.structuredContent;
    const content = Array.isArray(result.content) ? result.content.map(record) : [];
    const first = content[0]?.text;
    const text = typeof first === 'string' ? first.trim() : '';
    if (!text) return raw;
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return text;
    }
  }

  private reset(): void {
    this.sessionId = undefined;
    this.protocolVersion = MCP_PROTOCOL_VERSION;
    this.initPromise = undefined;
  }

  private async doInitialize(): Promise<void> {
    const result = record(
      await this.rpc(
        'initialize',
        {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: 'bidstack-sillage-client', version: '0.1.0' },
        },
        { skipInit: true },
      ),
    );
    // Spec-required echo: all subsequent requests carry the version the
    // SERVER selected, falling back to ours when the response omits it.
    this.protocolVersion =
      typeof result.protocolVersion === 'string' && result.protocolVersion
        ? result.protocolVersion
        : MCP_PROTOCOL_VERSION;
    await this.notify('notifications/initialized').catch(() => undefined);
  }

  private async rpc(
    method: string,
    params: Record<string, unknown>,
    opts: { skipInit?: boolean } = {},
  ): Promise<unknown> {
    if (!opts.skipInit) await this.initialize();
    const id = this.nextId++;
    const response = await this.postJsonRpc({ jsonrpc: '2.0', id, method, params }, { expectId: id });
    const envelope = record(response);
    const error = record(envelope.error);
    if (error.message) throw new Error(String(error.message));
    return envelope.result;
  }

  private async notify(method: string, params: Record<string, unknown> = {}): Promise<void> {
    await this.postJsonRpc({ jsonrpc: '2.0', method, params }, { notification: true });
  }

  private async postJsonRpc(
    body: Record<string, unknown>,
    opts: { notification?: boolean; expectId?: number } = {},
  ): Promise<unknown> {
    const response = await this.options.fetchImpl(this.options.url, {
      method: 'POST',
      redirect: 'error',
      headers: this.headers(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.options.timeoutMs),
    });
    const sessionId = response.headers.get('Mcp-Session-Id') ?? response.headers.get('mcp-session-id');
    if (sessionId && !this.sessionId) this.sessionId = sessionId;
    if (opts.notification && response.status === 202) return undefined;
    if (!response.ok) throw new Error(`sillage-mcp HTTP ${response.status}`);
    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('text/event-stream')) return readJsonFromEventStream(response, opts.expectId);
    const text = await response.text();
    return text ? (JSON.parse(text) as unknown) : undefined;
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'MCP-Protocol-Version': this.protocolVersion,
    };
    if (this.options.bearerToken) headers.Authorization = `Bearer ${this.options.bearerToken}`;
    if (this.sessionId) headers['Mcp-Session-Id'] = this.sessionId;
    return headers;
  }
}

// ── Client reuse ─────────────────────────────────────────────────────────────

// One client per distinct config so the MCP session persists across lookups.
// The fetch identity and timeout are part of the match (not the key) so tests
// that inject a fresh fake fetch per test never share a session with a
// previous test — a mismatch simply replaces the cached client.
const clientCache = new Map<string, { client: SillageMcpClient; options: SillageMcpClientOptions }>();

export function getSillageMcpClient(options: SillageMcpClientOptions, tool: string): SillageMcpClient {
  const key = `${options.url}::${options.bearerToken ?? ''}::${tool}`;
  const cached = clientCache.get(key);
  if (
    cached &&
    cached.options.fetchImpl === options.fetchImpl &&
    cached.options.timeoutMs === options.timeoutMs
  ) {
    return cached.client;
  }
  const client = new SillageMcpClient(options);
  clientCache.set(key, { client, options });
  return client;
}

// ── SSE parsing ──────────────────────────────────────────────────────────────

/** Join each SSE event's data: lines into one payload per event, in stream
 * order — the SSE spec lets a single event's payload span several data: lines
 * that must be re-joined with '\n' before parsing. */
function sseEventPayloads(text: string): string[] {
  const payloads: string[] = [];
  for (const block of text.split(/\r?\n\r?\n/)) {
    const dataLines = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      // SSE field syntax: a single optional space after the colon is not payload.
      .map((line) => line.slice('data:'.length).replace(/^ /, ''));
    if (dataLines.length === 0) continue;
    const payload = dataLines.join('\n');
    if (payload.trim()) payloads.push(payload);
  }
  return payloads;
}

/**
 * Pull the JSON-RPC RESPONSE out of a buffered SSE body. The stream may carry
 * server notifications before/after the response, so "last frame wins" is
 * wrong — the frame whose `id` matches the request wins, falling back to the
 * last valid response envelope (result/error present) when no id matches.
 * Full-buffer parse on purpose: this is only ever a single tool-call response,
 * never a long-lived stream.
 */
async function readJsonFromEventStream(response: Response, expectId?: number): Promise<unknown> {
  let fallback: unknown;
  let hasFallback = false;
  for (const payload of sseEventPayloads(await response.text())) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(payload) as unknown;
    } catch {
      continue; // keep-alive / non-JSON frame — cannot be the response
    }
    const envelope = record(parsed);
    if (envelope.jsonrpc !== '2.0') continue;
    if (expectId !== undefined && envelope.id === expectId) return parsed;
    if (envelope.result !== undefined || envelope.error !== undefined) {
      fallback = parsed;
      hasFallback = true;
    }
  }
  if (hasFallback) return fallback;
  throw new Error('sillage-mcp returned an empty event stream');
}
