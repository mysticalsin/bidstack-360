// Typed wrapper around an Odoo MCP server (ivnvxd/mcp-server-odoo).
// Connects over MCP's streamable-http transport: JSON-RPC 2.0 POSTed to a
// single endpoint, with optional SSE responses for streamed results.
//
// Design choices (Rule 11 — match the codebase):
//   - No @modelcontextprotocol/sdk dep. apps/mcp-server hand-rolls JSON-RPC;
//     this client mirrors that style. Surface is tiny (initialize, tools/list,
//     tools/call) and the SDK would dwarf its caller.
//   - Bearer auth optional. mcp-server-odoo runs as a private sidecar by
//     default; its auth lives at the Odoo layer (ODOO_API_KEY) not the MCP
//     transport. We expose a `bearerToken` slot so reverse proxies can gate it.
//   - We retry on 429 + 5xx with exponential backoff, like the Dust client,
//     so transient network blips don't break enrichment jobs.
//
// Reference: spec at https://modelcontextprotocol.io/specification/draft/basic/transports#streamable-http
//            and the Odoo-specific tool surface at https://github.com/ivnvxd/mcp-server-odoo

import pino from 'pino';
import { z } from 'zod';

import {
  OdooMcpError,
  type OdooMcpClientOptions,
  type SearchRecordsArgs,
  type GetRecordArgs,
  type CreateRecordArgs,
  type UpdateRecordArgs,
  type DeleteRecordArgs,
  type AggregateRecordsArgs,
  type PostMessageArgs,
  type CallModelMethodArgs,
} from './odoo-mcp-client.types.js';

// Re-export everything from the types module so callers using
// @bidstack/odoo-mcp-client see no change in their import paths.
export {
  OdooMcpError,
  type OdooMcpClientOptions,
  type OdooDomain,
  type SearchRecordsArgs,
  type GetRecordArgs,
  type CreateRecordArgs,
  type UpdateRecordArgs,
  type DeleteRecordArgs,
  type AggregateRecordsArgs,
  type PostMessageArgs,
  type CallModelMethodArgs,
} from './odoo-mcp-client.types.js';

// ─── Wire-format schemas ────────────────────────────────────────────────

const McpToolDescriptor = z
  .object({
    name: z.string(),
    description: z.string().optional(),
    inputSchema: z.unknown().optional(),
  })
  .passthrough();
export type McpToolDescriptor = z.infer<typeof McpToolDescriptor>;

const McpContentBlock = z
  .object({
    type: z.string(),
    text: z.string().optional(),
  })
  .passthrough();

const McpToolResult = z
  .object({
    content: z.array(McpContentBlock).optional(),
    structuredContent: z.unknown().optional(),
    isError: z.boolean().optional(),
  })
  .passthrough();

const McpJsonRpcResponse = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.union([z.string(), z.number()]).nullable().optional(),
  result: z.unknown().optional(),
  error: z
    .object({
      code: z.number(),
      message: z.string(),
      data: z.unknown().optional(),
    })
    .optional(),
});
type McpJsonRpcResponse = z.infer<typeof McpJsonRpcResponse>;

// ─── Client ─────────────────────────────────────────────────────────────

const DEFAULT_PROTOCOL_VERSION = '2025-06-18';
const DEFAULT_CLIENT_INFO = { name: 'bidstack-odoo-client', version: '0.1.0' };

export class OdooMcpClient {
  private readonly url: string;
  private readonly bearerToken: string | undefined;
  private readonly timeoutMs: number;
  private readonly log: pino.Logger;
  private readonly protocolVersion: string;
  private readonly clientInfo: { name: string; version: string };

  private sessionId: string | undefined;
  private initialized = false;
  private nextId = 1;

  constructor(opts: OdooMcpClientOptions) {
    if (!opts.url) throw new Error('OdooMcpClient: url required');
    this.url = opts.url;
    this.bearerToken = opts.bearerToken;
    this.timeoutMs = opts.timeoutMs ?? 15_000;
    this.log = opts.logger ?? pino({ name: 'odoo-mcp-client' });
    this.protocolVersion = opts.protocolVersion ?? DEFAULT_PROTOCOL_VERSION;
    this.clientInfo = opts.clientInfo ?? DEFAULT_CLIENT_INFO;
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────

  /**
   * Performs the MCP `initialize` handshake. Idempotent — subsequent calls
   * return immediately. Captures the `mcp-session-id` header for stateful
   * servers (mcp-server-odoo is stateful per the spec).
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    const result = await this.rpc(
      'initialize',
      {
        protocolVersion: this.protocolVersion,
        capabilities: {},
        clientInfo: this.clientInfo,
      },
      { skipInit: true },
    );
    this.log.debug({ result }, 'odoo-mcp: initialized');
    this.initialized = true;
    // Per spec, the client SHOULD send `notifications/initialized` once ready.
    // Best-effort — log but don't fail if the server doesn't accept it.
    try {
      await this.notify('notifications/initialized');
    } catch (err) {
      this.log.warn({ err }, 'odoo-mcp: notifications/initialized failed (non-fatal)');
    }
  }

  /** Lists every tool the server advertises. */
  async listTools(): Promise<McpToolDescriptor[]> {
    const raw = await this.rpc('tools/list', {});
    const parsed = z.object({ tools: z.array(McpToolDescriptor) }).safeParse(raw);
    if (!parsed.success) {
      throw new OdooMcpError('odoo-mcp: malformed tools/list response', 500, raw);
    }
    return parsed.data.tools;
  }

  /**
   * Generic `tools/call` dispatcher. Returns the parsed structured payload if
   * the server provided `structuredContent`, otherwise parses the first text
   * block as JSON. Surfaces tool-level errors as `OdooMcpError` so callers
   * never accidentally read a stale or error result.
   */
  async callTool<T = unknown>(name: string, args: Record<string, unknown>): Promise<T> {
    const raw = await this.rpc('tools/call', { name, arguments: args });
    const parsed = McpToolResult.safeParse(raw);
    if (!parsed.success) {
      throw new OdooMcpError(`odoo-mcp: malformed tools/call result for ${name}`, 500, raw);
    }
    if (parsed.data.isError) {
      const message =
        parsed.data.content?.find((b) => typeof b.text === 'string')?.text ??
        `Tool ${name} reported an error`;
      throw new OdooMcpError(message, 422, parsed.data);
    }
    if (parsed.data.structuredContent !== undefined) {
      return parsed.data.structuredContent as T;
    }
    const text = parsed.data.content?.find((b) => typeof b.text === 'string')?.text;
    if (text === undefined) return undefined as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      // Tool returned a plain string (e.g. a chatter message confirmation).
      return text as T;
    }
  }

  // ── High-level Odoo helpers ───────────────────────────────────────────

  searchRecords<T = unknown>(args: SearchRecordsArgs): Promise<T> {
    return this.callTool<T>('search_records', { ...args });
  }
  getRecord<T = unknown>(args: GetRecordArgs): Promise<T> {
    return this.callTool<T>('get_record', { ...args });
  }
  createRecord<T = unknown>(args: CreateRecordArgs): Promise<T> {
    return this.callTool<T>('create_record', { ...args });
  }
  updateRecord<T = unknown>(args: UpdateRecordArgs): Promise<T> {
    return this.callTool<T>('update_record', { ...args });
  }
  deleteRecord(args: DeleteRecordArgs): Promise<unknown> {
    return this.callTool('delete_record', { ...args });
  }
  aggregateRecords<T = unknown>(args: AggregateRecordsArgs): Promise<T> {
    return this.callTool<T>('aggregate_records', { ...args });
  }
  postMessage(args: PostMessageArgs): Promise<unknown> {
    return this.callTool('post_message', { ...args });
  }
  callModelMethod<T = unknown>(args: CallModelMethodArgs): Promise<T> {
    return this.callTool<T>('call_model_method', { ...args });
  }
  listModels<T = unknown>(): Promise<T> {
    return this.callTool<T>('list_models', {});
  }

  // ── Transport ─────────────────────────────────────────────────────────

  private async rpc(
    method: string,
    params: Record<string, unknown>,
    opts: { skipInit?: boolean } = {},
  ): Promise<unknown> {
    if (!opts.skipInit) await this.initialize();
    const id = this.nextId++;
    const body = JSON.stringify({ jsonrpc: '2.0', id, method, params });
    const res = await this.fetchWithRetry(body, /* isNotification */ false);
    const parsed = McpJsonRpcResponse.safeParse(res);
    if (!parsed.success) {
      throw new OdooMcpError(`odoo-mcp: invalid JSON-RPC envelope from ${method}`, 500, res);
    }
    if (parsed.data.error) {
      throw new OdooMcpError(
        parsed.data.error.message,
        500,
        parsed.data.error.data,
        parsed.data.error.code,
      );
    }
    return parsed.data.result;
  }

  private async notify(method: string, params: Record<string, unknown> = {}): Promise<void> {
    // JSON-RPC notification: same shape, no `id`. Server returns 202 with no body.
    const body = JSON.stringify({ jsonrpc: '2.0', method, params });
    await this.fetchWithRetry(body, /* isNotification */ true);
  }

  private async fetchWithRetry(
    body: string,
    isNotification: boolean,
    attempt = 0,
  ): Promise<unknown> {
    const ctl = new AbortController();
    const timeout = setTimeout(() => ctl.abort(), this.timeoutMs);

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'MCP-Protocol-Version': this.protocolVersion,
      };
      if (this.bearerToken) headers.Authorization = `Bearer ${this.bearerToken}`;
      if (this.sessionId) headers['Mcp-Session-Id'] = this.sessionId;

      const res = await fetch(this.url, {
        method: 'POST',
        headers,
        body,
        signal: ctl.signal,
      });

      // Stateful servers return a session id on the first response. Reuse it.
      const sid = res.headers.get('Mcp-Session-Id') ?? res.headers.get('mcp-session-id');
      if (sid && !this.sessionId) this.sessionId = sid;

      if ((res.status === 429 || res.status >= 500) && attempt < 3) {
        const retryAfter = Number(res.headers.get('Retry-After'));
        const wait =
          Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 250 * 2 ** attempt;
        this.log.warn({ status: res.status, wait, attempt }, 'odoo-mcp retry');
        await new Promise((r) => setTimeout(r, wait));
        return this.fetchWithRetry(body, isNotification, attempt + 1);
      }

      // Notifications produce 202 Accepted with no body.
      if (isNotification) {
        if (!res.ok) {
          throw new OdooMcpError(`odoo-mcp: notify failed (${res.status})`, res.status, null);
        }
        return undefined;
      }

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        // Never echo `this.url` into the error message — it may contain inline
        // credentials (`https://user:pass@host`) or a path-embedded token.
        throw new OdooMcpError(`odoo-mcp: HTTP ${res.status} from upstream`, res.status, text);
      }

      const contentType = res.headers.get('Content-Type') ?? '';
      if (contentType.includes('text/event-stream')) {
        return await readJsonFromEventStream(res);
      }
      const text = await res.text();
      return text ? (JSON.parse(text) as unknown) : undefined;
    } catch (err) {
      if (err instanceof OdooMcpError) throw err;
      if (err instanceof Error && err.name === 'AbortError') {
        throw new OdooMcpError(`odoo-mcp: request timed out after ${this.timeoutMs}ms`, 408, null);
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }
}

// ─── SSE helper ─────────────────────────────────────────────────────────

/**
 * For the streamable-http transport, the server MAY answer a request with an
 * SSE stream. The contract is: one or more `event: message` frames, each with
 * a `data:` line carrying a JSON-RPC response. The final frame for our
 * request id is the one we return.
 *
 * We read until we see a frame whose payload is a JSON-RPC response (has
 * `result` or `error`); intermediate notifications are logged and dropped.
 */
async function readJsonFromEventStream(res: Response): Promise<unknown> {
  if (!res.body) {
    throw new OdooMcpError('odoo-mcp: SSE response has no body', 500, null);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const { value, done } = await reader.read();
    if (value) buf += decoder.decode(value, { stream: true });
    let idx = buf.indexOf('\n\n');
    while (idx >= 0) {
      const frame = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const dataLines = frame
        .split('\n')
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).trimStart());
      if (dataLines.length) {
        const payload = dataLines.join('\n');
        try {
          const parsed = JSON.parse(payload) as unknown;
          if (parsed && typeof parsed === 'object' && ('result' in parsed || 'error' in parsed)) {
            return parsed;
          }
          // Notification frame; ignore and keep reading.
        } catch {
          // Malformed frame; skip.
        }
      }
      idx = buf.indexOf('\n\n');
    }
    if (done) break;
  }
  throw new OdooMcpError('odoo-mcp: SSE stream closed without a response frame', 500, null);
}
