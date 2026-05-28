/**
 * Dust AI agent service.
 *
 * Provides:
 *   - runRfpAgent()       — unified entry point for RFP phase agents (Wave 9)
 *   - defendBidScore()    — @deprecated, kept for existing callers
 *   - draftProposalSection() — @deprecated, kept for existing callers
 *
 * WHY runRfpAgent exists: Wave 9 standardises all RFP phase calls through one
 * function that enforces prompt injection defense, EU AI Act audit logging,
 * and per-template agent ID resolution. Callers should migrate to this.
 */

import { DustClient } from '@bidstack/dust-client';
import { RFP_AGENT_TEMPLATES } from '@bidstack/shared';
import { buildAgentUserMessage } from '../../lib/prompt-safety.js';
import { logAiInvocation } from '../../lib/ai-audit.js';
import { createLogger } from '../../lib/logger.js';

const log = createLogger({ name: 'dust-agent' });

// ─── Client factory ──────────────────────────────────────────────────────────

interface DustConfig {
  apiKey: string;
  workspaceId: string;
  dataSourceId?: string;
}

function getDefaultDustConfig(): DustConfig | null {
  const apiKey = process.env.DUST_API_KEY;
  const workspaceId = process.env.DUST_WORKSPACE_ID;
  if (!apiKey || !workspaceId) return null;
  return { apiKey, workspaceId, dataSourceId: process.env.DUST_DATA_SOURCE_ID };
}

function buildClient(cfg: DustConfig): DustClient {
  return new DustClient({
    apiKey: cfg.apiKey,
    workspaceId: cfg.workspaceId,
    timeoutMs: 15_000,
    logger: log,
  });
}

// ─── runRfpAgent ─────────────────────────────────────────────────────────────

export interface RunRfpAgentInput {
  orgId: string;
  userId?: string;
  /** Template ID from RFP_AGENT_TEMPLATES, e.g. "rfp-intake-agent". */
  templateId: string;
  /** Trusted variables interpolated into the template's userMessageTemplate. */
  trusted: Record<string, string | number>;
  /** Untrusted RFP document content — XML-escaped + enveloped before sending. */
  rfpContent?: string;
  /** Untrusted user-supplied text — XML-escaped + enveloped before sending. */
  userText?: string;
  /** Optional trace ID for Datadog correlation. */
  traceId?: string;
}

export interface RunRfpAgentResult {
  runId: string;
  output: Record<string, unknown>;
  tokenCount: number;
}

/**
 * Unified RFP phase agent runner.
 *
 * WHY this wraps runAgent: prompt injection defense and EU AI Act audit logging
 * are easy to forget at the call site. Centralising them here makes them
 * non-optional for all RFP agent calls.
 *
 * Per-org Dust config: OrgSettings does not currently store Dust credentials
 * (no dustApiKey/dustWorkspaceId column in schema as of Wave 9). All calls
 * fall back to DUST_* env vars. When per-org credentials are added, resolve
 * them here before falling back.
 */
export async function runRfpAgent(input: RunRfpAgentInput): Promise<RunRfpAgentResult> {
  const cfg = getDefaultDustConfig();
  if (!cfg) {
    throw new Error(
      'Dust not configured: DUST_API_KEY and DUST_WORKSPACE_ID env vars are required',
    );
  }

  // Resolve agent ID: per-template env var first, then generic exec brief fallback.
  // WHY env-based: allows per-environment Dust agent routing without code changes.
  const envKey = `DUST_${input.templateId.replace(/-/g, '_').toUpperCase()}_AGENT_ID`;
  const agentId = process.env[envKey] ?? process.env.DUST_AGENT_EXEC_BRIEF ?? '';

  if (!agentId) {
    throw new Error(
      `No Dust agent ID configured for templateId "${input.templateId}". ` +
        `Set ${envKey} or DUST_AGENT_EXEC_BRIEF env var.`,
    );
  }

  // Resolve template for system prompt and userMessageTemplate.
  // WHY lookup by id: RFP_AGENT_TEMPLATES is an array (not a Record) in @bidstack/shared.
  const template = RFP_AGENT_TEMPLATES.find((t) => t.id === input.templateId);
  const messageTemplate = template
    ? (template.defaultConfig.outputContract ?? input.templateId)
    : input.templateId;

  // Build injection-safe user message.
  const userMessage = buildAgentUserMessage({
    template: messageTemplate,
    trusted: input.trusted,
    rfpContent: input.rfpContent,
    userText: input.userText,
  });

  const client = buildClient(cfg);
  const model = template?.defaultConfig.model ?? 'dust';

  const startMs = Date.now();
  let rawOutput = '';
  let status: 'success' | 'error' | 'timeout' | 'rejected' = 'success';
  let errorMsg: string | undefined;

  try {
    const run = await client.runAgent(agentId, userMessage);
    rawOutput = run.output ?? '';
  } catch (err) {
    status = 'error';
    errorMsg = err instanceof Error ? err.message : String(err);
    log.error({ err, orgId: input.orgId, templateId: input.templateId }, 'runRfpAgent failed');
    throw err;
  } finally {
    const durationMs = Date.now() - startMs;
    // Fire-and-forget: audit failure must never block the caller.
    void logAiInvocation({
      orgId: input.orgId,
      userId: input.userId,
      agentType: input.templateId,
      model,
      prompt: userMessage,
      response: rawOutput,
      tokenCount: 0, // WHY 0: Dust runAgent does not surface token counts in its current contract
      durationMs,
      status,
      errorMsg,
      traceId: input.traceId,
    });
  }

  // Parse output as JSON if possible; otherwise wrap as plain string.
  let parsed: Record<string, unknown>;
  try {
    // WHY try-parse: most RFP agents are prompted to return JSON objects
    parsed = JSON.parse(rawOutput) as Record<string, unknown>;
  } catch {
    parsed = { text: rawOutput };
  }

  return {
    runId: `${input.templateId}-${Date.now()}`,
    output: parsed,
    tokenCount: 0,
  };
}

// ─── Legacy functions (kept for existing callers) ────────────────────────────

function getLegacyClient(): DustClient | null {
  const cfg = getDefaultDustConfig();
  if (!cfg) return null;
  return buildClient(cfg);
}

/**
 * @deprecated Use runRfpAgent() instead.
 * WHY kept: bid-scores and workspace routes call this directly; migrating them
 * is a separate story to avoid a large cross-scope diff.
 */
export async function defendBidScore(props: {
  agentId?: string;
  opportunityName: string;
  customer: string;
  totalScore: number;
  recommendation: string;
  criteria: Record<string, number>;
  memosContext: string;
}): Promise<{ reasoning: string; sources: string[] }> {
  const client = getLegacyClient();
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

/**
 * @deprecated Use runRfpAgent() instead.
 * WHY kept: bid-workspace routes call this directly; migration is a separate story.
 */
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
  const client = getLegacyClient();
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
    props.existingContent
      ? `Existing draft (revise and improve):\n${props.existingContent}\n`
      : 'Write a new draft.',
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
