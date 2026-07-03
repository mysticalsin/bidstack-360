/**
 * odoo-mcp-client.types.ts — Public interfaces and error class for OdooMcpClient.
 *
 * Extracted from index.ts (BS-R1 file-size refactor).
 * Re-exported from index.ts — callers continue to import from @bidstack/odoo-mcp-client.
 */
import type pino from 'pino';

// ─── Options ────────────────────────────────────────────────────────────

export interface OdooMcpClientOptions {
  /** Full URL of the MCP server's streamable-http endpoint (e.g. http://mcp-server-odoo:8000/mcp). */
  url: string;
  /** Optional bearer token if a reverse proxy gates the sidecar. */
  bearerToken?: string;
  /** Request timeout per call (default 15s — Odoo can be slow on big domains). */
  timeoutMs?: number;
  /** Pino logger; falls back to a named child if omitted. */
  logger?: pino.Logger;
  /** MCP protocol version the client speaks. Bumped via PR if upstream moves. */
  protocolVersion?: string;
  /** Identity reported in initialize. Defaults to Polo PreSales. */
  clientInfo?: { name: string; version: string };
}

// ─── Domain types ────────────────────────────────────────────────────────

/** Domain expression — Odoo's polish-notation filter (e.g. [['active','=',true]]). */
export type OdooDomain = ReadonlyArray<unknown>;

export interface SearchRecordsArgs {
  model: string;
  domain?: OdooDomain;
  fields?: string[];
  limit?: number;
  offset?: number;
  order?: string;
}

export interface GetRecordArgs {
  model: string;
  id: number;
  fields?: string[];
}

export interface CreateRecordArgs {
  model: string;
  values: Record<string, unknown>;
}

export interface UpdateRecordArgs {
  model: string;
  id: number;
  values: Record<string, unknown>;
}

export interface DeleteRecordArgs {
  model: string;
  id: number;
}

export interface AggregateRecordsArgs {
  model: string;
  domain?: OdooDomain;
  groupBy: string[];
  measures?: string[];
}

export interface PostMessageArgs {
  model: string;
  id: number;
  body: string;
  subject?: string;
}

export interface CallModelMethodArgs {
  model: string;
  method: string;
  args?: unknown[];
  kwargs?: Record<string, unknown>;
}

// ─── Error ───────────────────────────────────────────────────────────────

export class OdooMcpError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: unknown,
    public readonly code?: number,
  ) {
    super(message);
    this.name = 'OdooMcpError';
  }
}
