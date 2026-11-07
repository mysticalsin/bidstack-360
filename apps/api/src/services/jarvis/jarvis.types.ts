import type { AgentChange, AgentCitation } from '@bidstack/db/agent-tools';

/** Record ids read off the current route. "This" resolves to these. */
export interface JarvisContext {
  accountId?: string;
  opportunityId?: string;
  proposalId?: string;
  rfpOpportunityId?: string;
}

export type JarvisStepStatus = 'running' | 'done' | 'error' | 'denied' | 'pending';

export interface JarvisStep {
  id: string;
  tool: string;
  kind: 'read' | 'write';
  status: JarvisStepStatus;
  summary: string;
  durationMs?: number;
}

export interface JarvisAnswer {
  text: string;
  citations: AgentCitation[];
  missing: string[];
}

export interface JarvisPendingActionView {
  id: string;
  tool: string;
  title: string;
  changes: AgentChange[];
  citation?: AgentCitation;
}

export interface JarvisRunView {
  runId: string;
  status: 'running' | 'done' | 'error';
  mode: 'llm' | 'demo';
  steps: JarvisStep[];
  answer: JarvisAnswer | null;
  pendingActions: JarvisPendingActionView[];
}

/** What a planner has seen so far: one entry per executed (or staged) tool. */
export interface JarvisToolResult {
  tool: string;
  ok: boolean;
  output?: unknown;
  error?: string;
}

export type JarvisTurn =
  | { type: 'tool'; tool: string; args: Record<string, unknown> }
  | { type: 'answer'; text: string; citations?: AgentCitation[]; missing?: string[] };

/** Deterministic planner turns always carry citations and missing. */
export type JarvisFallbackTurn =
  | { type: 'tool'; tool: string; args: Record<string, unknown> }
  | { type: 'answer'; text: string; citations: AgentCitation[]; missing: string[] };
