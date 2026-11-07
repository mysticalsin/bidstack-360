/**
 * Deterministic Jarvis planner for demo mode (no LLM configured or budget
 * spent). Maps the supported asks onto the shared tools in code (CLAUDE.md
 * rule 5: if code can answer, code answers) and composes the answer from the
 * tool output. Writes come back as tool turns; the loop stages them as
 * pending actions, it never executes them.
 */
import { composeAnswer } from './jarvis.answer.js';
import type { JarvisContext, JarvisFallbackTurn, JarvisToolResult } from './jarvis.types.js';

export interface FallbackInput {
  message: string;
  context: JarvisContext;
  results: JarvisToolResult[];
  now: Date;
}

type Intent = 'task' | 'overdue' | 'rfp' | 'proposal' | 'updates' | 'lookup';

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const UPDATE_WINDOW_DAYS = 14;

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** "for Friday" means the next Friday, never today. UTC calendar days. */
export function resolveDueDate(text: string, now: Date): string | null {
  const t = text.toLowerCase();
  const base = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const plus = (days: number) => isoDay(new Date(base.getTime() + days * 86_400_000));
  const iso = /\b(\d{4}-\d{2}-\d{2})\b/.exec(t);
  if (iso?.[1]) return iso[1];
  if (/\btomorrow\b/.test(t)) return plus(1);
  if (/\b(today|tonight)\b/.test(t)) return plus(0);
  if (/\bnext week\b/.test(t)) return plus(7);
  for (const [index, name] of WEEKDAYS.entries()) {
    if (new RegExp(`\\b${name}\\b`).test(t)) {
      const diff = (index - base.getUTCDay() + 7) % 7;
      return plus(diff === 0 ? 7 : diff);
    }
  }
  return null;
}

function intentOf(message: string): Intent {
  const m = message.toLowerCase();
  if (/\b(create|add|make|schedule|set up|log)\b[^.?!]*\btasks?\b|\bremind me\b/.test(m)) return 'task';
  if (/\b(overdue|late|past due|behind schedule)\b/.test(m)) return 'overdue';
  if (/\b(rfp|rfps|tender|requirements?)\b/.test(m)) return 'rfp';
  if (/\b(proposal|proposals)\b/.test(m)) return 'proposal';
  if (/\b(changed?|changes|updates?|happened|news|activity|activities|this week)\b/.test(m)) {
    return 'updates';
  }
  return 'lookup';
}

function taskTitle(message: string): string {
  const to = /\btask\s+to\s+(.+?)(?:\s+(?:for|by|on|due)\s+\w+)?[.?!]*$/i.exec(message);
  const phrase = to?.[1]?.trim();
  if (!phrase) return 'Follow-up';
  return phrase.charAt(0).toUpperCase() + phrase.slice(1, 200);
}

interface Resolved {
  accounts: Array<{ id: string }>;
  opportunities: Array<{ id: string; companyId?: string | null }>;
  proposals: Array<{ id: string }>;
}

function resolvedFrom(results: JarvisToolResult[]): Resolved | null {
  const hit = results.find((r) => r.tool === 'records.resolve' && r.ok);
  if (!hit) return null;
  const o = (hit.output ?? {}) as Partial<Resolved>;
  return {
    accounts: o.accounts ?? [],
    opportunities: o.opportunities ?? [],
    proposals: o.proposals ?? [],
  };
}

function has(results: JarvisToolResult[], tool: string): boolean {
  return results.some((r) => r.tool === tool);
}

function tool(name: string, args: Record<string, unknown>): JarvisFallbackTurn {
  return { type: 'tool', tool: name, args };
}

function missing(text: string, results: JarvisToolResult[], reason: string): JarvisFallbackTurn {
  const base = composeAnswer(results);
  return { type: 'answer', text, citations: base.citations, missing: [reason, ...base.missing] };
}

export function nextFallbackTurn(input: FallbackInput): JarvisFallbackTurn {
  const { message, context, results, now } = input;
  const intent = intentOf(message);
  const wantsThis = /\b(this|here|current)\b/i.test(message);
  const resolved = resolvedFrom(results);
  const resolve = () => tool('records.resolve', { text: message });
  const ctxOpp = context.opportunityId ?? context.rfpOpportunityId;

  switch (intent) {
    case 'overdue':
      return has(results, 'bids.overdue') ? composeAnswer(results) : tool('bids.overdue', {});

    case 'task': {
      if (has(results, 'tasks.create')) return composeAnswer(results);
      const oppId = ctxOpp ?? resolved?.opportunities[0]?.id;
      if (!oppId) {
        if (!resolved) return resolve();
        return missing(
          'I need an opportunity to attach the task to. Open one, or name it.',
          results,
          'No opportunity in context for the task.',
        );
      }
      const due = resolveDueDate(message, now);
      return tool('tasks.create', {
        oppId,
        title: taskTitle(message),
        ...(due ? { dueDate: due } : {}),
      });
    }

    case 'rfp': {
      if (has(results, 'rfp.summary')) return composeAnswer(results);
      const oppId =
        (wantsThis ? ctxOpp : undefined) ?? resolved?.opportunities[0]?.id ?? ctxOpp;
      if (oppId) return tool('rfp.summary', { opportunityId: oppId });
      if (!resolved) return resolve();
      return missing(
        'Open an RFP or name its opportunity and I will summarize it.',
        results,
        'No RFP in context.',
      );
    }

    case 'proposal': {
      if (has(results, 'proposal.status')) return composeAnswer(results);
      if (wantsThis && context.proposalId) {
        return tool('proposal.status', { proposalId: context.proposalId });
      }
      if (wantsThis && ctxOpp) return tool('proposal.status', { opportunityId: ctxOpp });
      if (wantsThis && context.accountId) {
        return tool('proposal.status', { accountId: context.accountId });
      }
      if (!resolved) return resolve();
      if (resolved.proposals[0]) {
        return tool('proposal.status', { proposalId: resolved.proposals[0].id });
      }
      if (resolved.opportunities[0]) {
        return tool('proposal.status', { opportunityId: resolved.opportunities[0].id });
      }
      if (resolved.accounts[0]) {
        return tool('proposal.status', { accountId: resolved.accounts[0].id });
      }
      if (context.proposalId) return tool('proposal.status', { proposalId: context.proposalId });
      if (ctxOpp) return tool('proposal.status', { opportunityId: ctxOpp });
      return missing('No proposal matched that name.', results, 'No matching proposal.');
    }

    case 'updates': {
      if (has(results, 'account.updates') || has(results, 'opportunities.get')) {
        return composeAnswer(results);
      }
      if (wantsThis && context.accountId) {
        return tool('account.updates', { accountId: context.accountId, days: UPDATE_WINDOW_DAYS });
      }
      if (wantsThis && ctxOpp) return tool('opportunities.get', { id: ctxOpp });
      if (!resolved) return resolve();
      const accountId =
        resolved.accounts[0]?.id ?? resolved.opportunities[0]?.companyId ?? context.accountId;
      if (accountId) {
        return tool('account.updates', { accountId, days: UPDATE_WINDOW_DAYS });
      }
      if (resolved.opportunities[0]) {
        return tool('opportunities.get', { id: resolved.opportunities[0].id });
      }
      return missing('I could not find that account.', results, 'No matching account.');
    }

    default: {
      const done = results.some((r) => r.tool !== 'records.resolve');
      if (done) return composeAnswer(results);
      if (!resolved) return resolve();
      if (resolved.opportunities[0]) {
        return tool('opportunities.get', { id: resolved.opportunities[0].id });
      }
      if (resolved.accounts[0]) {
        return tool('account.updates', { accountId: resolved.accounts[0].id, days: UPDATE_WINDOW_DAYS });
      }
      if (resolved.proposals[0]) {
        return tool('proposal.status', { proposalId: resolved.proposals[0].id });
      }
      if (ctxOpp) return tool('opportunities.get', { id: ctxOpp });
      if (context.accountId) {
        return tool('account.updates', { accountId: context.accountId, days: UPDATE_WINDOW_DAYS });
      }
      if (context.proposalId) return tool('proposal.status', { proposalId: context.proposalId });
      return missing(
        'I could not match that to a record. Name an account, an opportunity code or a proposal.',
        results,
        'No matching record.',
      );
    }
  }
}
