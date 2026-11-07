// One wrapper around every MCP tool call: grant check (scope + read-only),
// Serum policy, full input validation, a per-call audit row, an output size
// cap, and helpers to fence CRM record text as untrusted data.

import type { z } from 'zod';

import type { McpAuthCtx } from '../auth.js';

export type ToolGrantScope = 'read' | 'write' | 'kam';

/** Hard ceiling on a single tool result; larger payloads waste the model's context. */
export const MAX_TOOL_OUTPUT_BYTES = 64 * 1024;

export const UNTRUSTED_OPEN = '<untrusted-record-text>';
export const UNTRUSTED_CLOSE = '</untrusted-record-text>';

/**
 * Scope check plus the connection grant: a read-only key can call read tools
 * only, even when it also carries `write` or `kam`, mirroring the REST gate.
 */
export function assertToolGrant(ctx: McpAuthCtx, scope: ToolGrantScope): void {
  if (!ctx.scopes.includes(scope)) {
    throw new Error(`API key lacks \`${scope}\` scope`);
  }
  if (ctx.readOnly && scope !== 'read') {
    throw new Error('API key is read-only; this tool changes data');
  }
}

/**
 * Wrap record text (subjects, notes, transcripts) so the calling model treats
 * it as data, never as instructions. A close marker inside the text is
 * neutralised so the record cannot end the fence early.
 */
export function fenceUntrusted(text: string | null | undefined): string | null {
  if (text === null || text === undefined) return null;
  const safe = text.split(UNTRUSTED_CLOSE).join('</untrusted-record-text\u200b>');
  return `${UNTRUSTED_OPEN}${safe}${UNTRUSTED_CLOSE}`;
}

export function capToolOutput(text: string): { text: string; truncated: boolean; bytes: number } {
  const bytes = Buffer.byteLength(text);
  if (bytes <= MAX_TOOL_OUTPUT_BYTES) return { text, truncated: false, bytes };
  return {
    text: JSON.stringify({
      truncated: true,
      limitBytes: MAX_TOOL_OUTPUT_BYTES,
      bytes,
      hint: 'Result too large. Narrow the query or lower the limit.',
    }),
    truncated: true,
    bytes,
  };
}

export interface ToolAuditEntry {
  action: 'mcp.tool.call';
  orgId: string;
  keyId: string;
  diff: {
    tool: string;
    scope: ToolGrantScope;
    ok: boolean;
    error?: string;
    bytes?: number;
    truncated?: boolean;
    durationMs: number;
  };
}

interface CallableTool {
  input: z.ZodTypeAny;
  handler: (args: never, ctx: McpAuthCtx) => Promise<unknown>;
}

export interface ToolCallResult {
  [key: string]: unknown;
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

export async function runToolCall(input: {
  name: string;
  tool: CallableTool;
  scope: ToolGrantScope;
  args: unknown;
  ctx: McpAuthCtx;
  audit: (entry: ToolAuditEntry) => Promise<unknown>;
  serum: (ctx: McpAuthCtx, name: string) => Promise<unknown>;
}): Promise<ToolCallResult> {
  const started = Date.now();
  const record = async (diff: Omit<ToolAuditEntry['diff'], 'tool' | 'scope' | 'durationMs'>) => {
    try {
      await input.audit({
        action: 'mcp.tool.call',
        orgId: input.ctx.orgId,
        keyId: input.ctx.keyId,
        diff: { tool: input.name, scope: input.scope, durationMs: Date.now() - started, ...diff },
      });
    } catch {
      // An audit outage must not fail the tool call.
    }
  };

  try {
    assertToolGrant(input.ctx, input.scope);
    await input.serum(input.ctx, input.name);
    // The SDK only checks the raw shape; re-parse for refinements and strictness.
    const parsed = input.tool.input.safeParse(input.args);
    if (!parsed.success) {
      throw new Error(`Invalid input: ${parsed.error.issues.map((i) => i.message).join('; ')}`);
    }
    const out = await input.tool.handler(parsed.data as never, input.ctx);
    const capped = capToolOutput(JSON.stringify(out, null, 2) ?? 'null');
    await record({ ok: true, bytes: capped.bytes, truncated: capped.truncated });
    return { content: [{ type: 'text', text: capped.text }] };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error';
    await record({ ok: false, error: message.slice(0, 200) });
    return { content: [{ type: 'text', text: message }], isError: true };
  }
}
