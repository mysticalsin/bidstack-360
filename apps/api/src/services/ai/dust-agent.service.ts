/**
 * Dust AI agent service.
 *
 * Provides:
 *   - defendBidScore()    — @deprecated, kept for existing callers
 *   - draftProposalSection() — @deprecated, kept for existing callers
 *
 * The RFP Agent squad (runRfpAgent + NocoBase proxy) was removed with the
 * innovation cluster; only the bid-score and proposal helpers remain.
 */

import { buildAgentUserMessage } from '../../lib/prompt-safety.js';
import { createLogger } from '../../lib/logger.js';
import { getOrgDust, resolveAgentId } from '../../lib/dust-credentials.js';

const log = createLogger({ name: 'dust-agent' });


// ─── Legacy functions (kept for existing callers) ────────────────────────────

/**
 * Direct Dust agent call; audit-logged via logAiInvocation.
 * WHY kept: bid-scores and workspace routes call this directly; migrating them
 * is a separate story to avoid a large cross-scope diff.
 */
export async function defendBidScore(props: {
  orgId: string;
  agentId?: string;
  opportunityName: string;
  customer: string;
  totalScore: number;
  recommendation: string;
  criteria: Record<string, number>;
  memosContext: string;
}): Promise<{ reasoning: string; sources: string[] }> {
  const { client, creds } = await getOrgDust(props.orgId, log);
  if (!client) {
    return {
      reasoning: `Score ${props.totalScore}/100 (${props.recommendation}) for ${props.opportunityName}. This is a heuristic fallback because Dust is not configured.`,
      sources: ['heuristic'],
    };
  }

  const agentId =
    resolveAgentId(creds, 'execBrief', props.agentId ?? process.env.DUST_AGENT_EXEC_BRIEF) ?? '';
  if (!agentId) {
    return {
      reasoning: `No Dust agent configured for score defense. Set DUST_AGENT_EXEC_BRIEF env var.`,
      sources: [],
    };
  }

  // §PROMPT-INJECTION-DEFENSE — customer name, opportunity name, and memosContext
  // are all user-controlled strings. Interpolating them directly into the prompt
  // allows an attacker to inject instructions (e.g. "Ignore previous instructions...").
  // buildAgentUserMessage() XML-escapes untrusted content and envelopes it so the
  // model treats it as data, not instructions. Trusted numerics go in {{PLACEHOLDERS}}.
  const criteriaBreakdown = Object.entries(props.criteria)
    .map(([k, v]) => `  - ${k}: ${v}/5`)
    .join('\n');
  const prompt = buildAgentUserMessage({
    template: [
      'You are a pre-sales director reviewing a Bid/No-Bid score.',
      'Score: {{TOTAL_SCORE}}/100',
      'Recommendation: {{RECOMMENDATION}}',
      'Criteria breakdown:\n{{CRITERIA_BREAKDOWN}}',
      '',
      'Task: Defend or challenge this score in 3-5 sentences. Cite specific criteria and historical patterns. Be concise and actionable.',
    ].join('\n'),
    trusted: {
      TOTAL_SCORE: props.totalScore,
      RECOMMENDATION: props.recommendation,
      CRITERIA_BREAKDOWN: criteriaBreakdown,
    },
    userText: `Customer: ${props.customer}\nOpportunity: ${props.opportunityName}\n\nHistorical context from MemOS:\n${props.memosContext || '(no historical data)'}`,
  });

  try {
    const run = await client.runAgent(agentId, prompt);
    const reasoning = run.output ?? 'No output from Dust agent.';
    return { reasoning, sources: ['dust-agent', agentId] };
  } catch (err) {
    log.warn({ err }, 'dust score defense failed');
    return {
      reasoning: `Dust agent unavailable. Score ${props.totalScore}/100 (${props.recommendation}) based on weighted criteria.`,
      sources: ['fallback'],
    };
  }
}

/**
 * Direct Dust agent call; audit-logged via logAiInvocation.
 * WHY kept: bid-workspace routes call this directly; migration is a separate story.
 */
export async function draftProposalSection(props: {
  orgId: string;
  agentId?: string;
  sectionKey: string;
  sectionTitle: string;
  proposalName: string;
  customer: string;
  opportunityContext: string;
  memosContext: string;
  existingContent: string;
}): Promise<{ content: string; sources: string[] }> {
  const { client, creds } = await getOrgDust(props.orgId, log);
  if (!client) {
    return {
      content: `[Dust not configured] Draft for ${props.sectionTitle} of ${props.proposalName}.`,
      sources: ['heuristic'],
    };
  }

  const agentId =
    resolveAgentId(creds, 'sectionDraft', props.agentId ?? process.env.DUST_AGENT_EXEC_BRIEF) ?? '';
  if (!agentId) {
    return {
      content: `[No agent configured] Draft for ${props.sectionTitle}. Set DUST_AGENT_EXEC_BRIEF.`,
      sources: [],
    };
  }

  // §PROMPT-INJECTION-DEFENSE — sectionTitle, customer, proposalName,
  // opportunityContext, memosContext, and existingContent are all user-controlled.
  // buildAgentUserMessage() XML-escapes and envelopes untrusted content so the
  // model treats it as data. sectionTitle goes into {{SECTION_TITLE}} which is
  // trusted-interpolated (server-side section key, not raw user text).
  const userContext = [
    `Customer: ${props.customer}`,
    `Proposal: ${props.proposalName}`,
    '',
    'Opportunity context:',
    props.opportunityContext || '(none)',
    '',
    'Relevant historical content from MemOS:',
    props.memosContext || '(none)',
    '',
    props.existingContent
      ? `Existing draft (revise and improve):\n${props.existingContent}`
      : 'Write a new draft.',
  ].join('\n');
  const prompt = buildAgentUserMessage({
    template: [
      'You are a proposal writer drafting the "{{SECTION_TITLE}}" section.',
      'Task: Write a professional, compelling {{SECTION_TITLE}} in 200-400 words.',
      'Use specific examples where possible. Output only the section content, no markdown headers.',
    ].join('\n'),
    trusted: { SECTION_TITLE: props.sectionTitle },
    userText: userContext,
  });

  try {
    const run = await client.runAgent(agentId, prompt);
    const content = run.output ?? `[Dust returned no output for ${props.sectionTitle}]`;
    return { content, sources: ['dust-agent', agentId] };
  } catch (err) {
    log.warn({ err }, 'dust proposal draft failed');
    return {
      content: `[Dust agent error] Please try again or write manually.`,
      sources: ['fallback'],
    };
  }
}
