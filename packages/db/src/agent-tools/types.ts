import type { z } from 'zod';

import type { PermissionKey } from '@bidstack/shared';

/** Caller identity for a tool run. MCP passes its API-key context (orgId,
 *  keyId, scopes); Jarvis passes the signed-in user. */
export interface AgentToolCtx {
  orgId: string;
  userId?: string | null;
  surface?: 'mcp' | 'jarvis';
}

export type AgentToolKind = 'read' | 'write';

/** A record an answer can link to. `href` is an app route, never a URL. */
export interface AgentCitation {
  kind: 'account' | 'opportunity' | 'proposal' | 'rfp' | 'task' | 'activity';
  label: string;
  href: string;
  date?: string | null;
}

export interface AgentChange {
  field: string;
  value: string;
}

/** What a write will do, shown to the user before it runs. */
export interface AgentToolPreview {
  title: string;
  changes: AgentChange[];
  citation?: AgentCitation;
}

export interface AgentTool<I extends z.ZodTypeAny = z.ZodTypeAny, O = unknown> {
  description: string;
  input: I;
  inputJsonSchema: Record<string, unknown>;
  kind: AgentToolKind;
  /** RBAC permission Jarvis checks before a read and again on confirm. */
  permission: PermissionKey;
  handler(args: z.infer<I>, ctx: AgentToolCtx): Promise<O>;
  /** Required for writes: resolves the exact change without writing. */
  preview?(args: z.infer<I>, ctx: AgentToolCtx): Promise<AgentToolPreview>;
}

export function isoDate(value: Date | null | undefined): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

export function oppCitation(opp: {
  id: string;
  code: string;
  name: string;
  dueDate?: Date | null;
}): AgentCitation {
  return {
    kind: 'opportunity',
    label: `${opp.code} ${opp.name}`,
    href: `/opportunities/${opp.id}`,
    date: isoDate(opp.dueDate ?? null),
  };
}
