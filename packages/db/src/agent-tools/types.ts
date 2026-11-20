import type { z } from 'zod';

import type { PermissionKey } from '@bidstack/shared';

import type { Prisma } from '../index.js';

/** Caller identity for a tool run. MCP passes its API-key context (orgId,
 *  keyId, scopes); Jarvis passes the signed-in user. */
export interface AgentToolCtx {
  orgId: string;
  userId?: string | null;
  surface?: 'mcp' | 'jarvis';
  /** MCP: false limits the key to `companyIds` (same allowlist as REST). */
  unrestrictedScope?: boolean;
  companyIds?: string[];
  /** Jarvis: company visibility from the user's access groups; null = org-wide. */
  companyScope?: Prisma.CompanyWhereInput | null;
  /** Jarvis: the user may see every proposal (org-admin override), not only their own. */
  viewAllProposals?: boolean;
  /** Jarvis: RBAC check for the extra resources a composite tool returns. */
  can?: (permission: PermissionKey) => Promise<boolean>;
}

/** Company predicate for the caller, or null when every org company is visible. */
export function companyScopeWhere(ctx: AgentToolCtx): Prisma.CompanyWhereInput | null {
  if (ctx.companyScope !== undefined) return ctx.companyScope;
  if (ctx.unrestrictedScope === false) return { id: { in: ctx.companyIds ?? [] } };
  return null;
}

/** Jarvis users see only proposals they own unless they hold the admin override,
 *  mirroring the REST proposal routes. */
export function proposalOwnerWhere(ctx: AgentToolCtx): Prisma.ProposalWhereInput {
  if (ctx.surface !== 'jarvis' || ctx.viewAllProposals) return {};
  return ctx.userId ? { ownerId: ctx.userId } : { id: { in: [] } };
}

/** Whether the caller may read a resource a composite tool includes. MCP keys are
 *  bounded by their scope grant instead, so no `can` means allowed. */
export async function callerCan(ctx: AgentToolCtx, permission: PermissionKey): Promise<boolean> {
  return ctx.can ? ctx.can(permission) : true;
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
