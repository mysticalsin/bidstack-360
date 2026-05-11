// JSON-RPC 2.0 dispatcher. Implements MCP `tools/list` + `tools/call` plus
// the 6 tools defined in handoff/mcp.tools.md.

import type { FastifyBaseLogger } from 'fastify';

import type { McpAuthCtx } from './auth.js';
import { tools, type ToolName } from './tools/index.js';

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number | string | null;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export async function handleRpc(
  body: unknown,
  ctx: McpAuthCtx,
  log: FastifyBaseLogger,
): Promise<JsonRpcResponse | JsonRpcResponse[]> {
  if (Array.isArray(body)) {
    return Promise.all(body.map((item) => handleSingle(item as JsonRpcRequest, ctx, log)));
  }
  return handleSingle(body as JsonRpcRequest, ctx, log);
}

async function handleSingle(
  req: JsonRpcRequest,
  ctx: McpAuthCtx,
  log: FastifyBaseLogger,
): Promise<JsonRpcResponse> {
  const reply = (result?: unknown, error?: JsonRpcResponse['error']): JsonRpcResponse => ({
    jsonrpc: '2.0',
    id: req?.id ?? null,
    ...(result !== undefined ? { result } : {}),
    ...(error !== undefined ? { error } : {}),
  });

  if (!req || req.jsonrpc !== '2.0' || typeof req.method !== 'string') {
    return reply(undefined, { code: -32600, message: 'Invalid Request' });
  }

  try {
    if (req.method === 'tools/list') {
      return reply({
        tools: Object.entries(tools).map(([name, t]) => ({
          name,
          description: t.description,
          inputSchema: t.inputJsonSchema,
        })),
      });
    }

    if (req.method === 'tools/call') {
      const params = req.params as { name?: string; arguments?: Record<string, unknown> };
      const name = params?.name as ToolName | undefined;
      if (!name || !(name in tools)) {
        return reply(undefined, { code: -32602, message: `Unknown tool: ${name}` });
      }
      // Each tool has its own input/output type; the union-narrowed handler
      // signature confuses TypeScript when called dynamically. Each handler
      // does its own Zod parse, so we narrow once at dispatch.
      const tool = tools[name];
      const args = tool.input.parse(params.arguments ?? {}) as never;
      const handler = tool.handler as (a: never, c: McpAuthCtx) => Promise<unknown>;
      const out = await handler(args, ctx);
      return reply({
        content: [{ type: 'text', text: JSON.stringify(out, null, 2) }],
        structuredContent: out,
      });
    }

    return reply(undefined, { code: -32601, message: `Method not found: ${req.method}` });
  } catch (err) {
    log.error({ err, method: req.method }, 'rpc handler failed');
    const message = err instanceof Error ? err.message : 'Internal error';
    return reply(undefined, { code: -32603, message });
  }
}
