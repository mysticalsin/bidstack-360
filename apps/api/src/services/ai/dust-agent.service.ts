import { DustClient } from '@bidstack/dust-client';
import pino from 'pino';

const log = pino({ name: 'dust-agent', level: process.env.LOG_LEVEL ?? 'info' });

function getClient(): DustClient | null {
  const apiKey = process.env.DUST_API_KEY;
  const workspaceId = process.env.DUST_WORKSPACE_ID;
  if (!apiKey || !workspaceId) return null;
  return new DustClient({ apiKey, workspaceId, timeoutMs: 15_000, logger: log });
}

export async function defendBidScore(props: {
  agentId?: string;
  opportunityName: string;
  customer: string;
  totalScore: number;
  recommendation: string;
  criteria: Record<string, number>;
  memosContext: string;
}): Promise<{ reasoning: string; sources: string[] }> {
  const client = getClient();
  if (!client) {
    return {
      reasoning: `Score ${props.totalScore}/100 (${props.recommendation}) for ${props.opportunityName}. This is a heuristic fallback because DUST_API_KEY is not configured.`,
      sources: ['heuristic'],
    };
  }

  const agentId = props.agentId ?? process.env.DUST_AGENT_EXEC_BRIEF ?? '';
  if (!agentId) {
    return {
      reasoning: `No Dust agent configured for score defense. Set DUST_AGENT_EXEC_BRIEF env var.`,
      sources: [],
    };
  }

  const prompt = [
    `You are a pre-sales director reviewing a Bid/No-Bid score for ${props.customer}: "${props.opportunityName}".`,
    ``,
    `Score: ${props.totalScore}/100`,
    `Recommendation: ${props.recommendation}`,
    `Criteria breakdown:`,
    ...Object.entries(props.criteria).map(([k, v]) => `  - ${k}: ${v}/5`),
    ``,
    `Historical context from MemOS:`,
    props.memosContext || '(no historical data)',
    ``,
    `Task: Defend or challenge this score in 3-5 sentences. Cite specific criteria and historical patterns. Be concise and actionable.`,
  ].join('\n');

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

export async function draftProposalSection(props: {
  agentId?: string;
  sectionKey: string;
  sectionTitle: string;
  proposalName: string;
  customer: string;
  opportunityContext: string;
  memosContext: string;
  existingContent: string;
}): Promise<{ content: string; sources: string[] }> {
  const client = getClient();
  if (!client) {
    return {
      content: `[Dust not configured] Draft for ${props.sectionTitle} of ${props.proposalName}.`,
      sources: ['heuristic'],
    };
  }

  const agentId = props.agentId ?? process.env.DUST_AGENT_EXEC_BRIEF ?? '';
  if (!agentId) {
    return {
      content: `[No agent configured] Draft for ${props.sectionTitle}. Set DUST_AGENT_EXEC_BRIEF.`,
      sources: [],
    };
  }

  const prompt = [
    `You are a proposal writer drafting the "${props.sectionTitle}" section for a proposal to ${props.customer}: "${props.proposalName}".`,
    ``,
    `Opportunity context:`,
    props.opportunityContext || '(none)',
    ``,
    `Relevant historical content from MemOS:`,
    props.memosContext || '(none)',
    ``,
    props.existingContent ? `Existing draft (revise and improve):\n${props.existingContent}\n` : 'Write a new draft.',
    ``,
    `Task: Write a professional, compelling ${props.sectionTitle} in 200-400 words. Use specific examples where possible. Output only the section content, no markdown headers.`,
  ].join('\n');

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
