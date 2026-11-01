/**
 * ai-assistant.deals.service.ts — deal sentiment + account intel pipelines.
 *
 * Extracted from ai-assistant.service.ts (BS-R1 file-size refactor).
 * Import DAG: helpers (leaf) ← context ← this file.
 */
import type { Logger as PinoLogger } from 'pino';

import {
  type AccountIntelResult,
  type DealSentimentResult,
  buildDustClient,
  resolveAgentId,
  checkDailyCap,
  estimateCost,
  persistSession,
  recordCost,
} from './ai-assistant.helpers.js';
import { buildAccountIntelContext, buildSentimentContext } from './ai-assistant.context.js';

// ─── Deal sentiment ───────────────────────────────────────────────────────────

/** Activity count only. A count is not a sentiment score. */
export function recordedDealSentiment(activityCount: number): {
  score: null;
  label: null;
  summary: string;
  riskFlags: [];
  suggestedActions: [];
} {
  return {
    score: null,
    label: null,
    summary: `${activityCount} activities recorded for this deal. No sentiment score was produced.`,
    riskFlags: [],
    suggestedActions: [],
  };
}

export function parseDealSentimentScore(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < -1 || value > 1) return null;
  return value;
}

export function parseDealSentimentLabel(
  value: unknown,
): 'positive' | 'neutral' | 'negative' | null {
  if (value === 'positive' || value === 'neutral' || value === 'negative') return value;
  return null;
}

// ─── Deal sentiment runner ────────────────────────────────────────────────────

export async function analyzeDealSentiment(
  opts: { orgId: string; userId: string; dealId: string },
  log: PinoLogger,
): Promise<DealSentimentResult> {
  const childLog = log.child({ feature: 'ai-assistant', action: 'deal-sentiment' });

  const cap = await checkDailyCap(opts.orgId, opts.userId, childLog);
  if (!cap.allowed) {
    throw Object.assign(new Error(cap.reason ?? 'Daily AI cap reached'), {
      statusCode: 429,
      retryAfterSeconds: cap.retryAfterSeconds,
    });
  }

  const { opp, activitiesSummary, activities } = await buildSentimentContext(
    opts.orgId,
    opts.dealId,
  );

  const prompt =
    `Analyse deal sentiment for "${opp.name}" (stage: ${opp.stage}).\n` +
    `Recent activities (newest first):\n${activitiesSummary || 'No activities recorded.'}\n\n` +
    `Return JSON: {"score": <-1..1>, "label": "positive|neutral|negative", "summary": "...", "riskFlags": [...], "suggestedActions": [...]}`;

  const { client: dust, creds } = await buildDustClient(opts.orgId, childLog);
  const sentimentAgentId = resolveAgentId(creds, 'sentiment', process.env.DUST_AGENT_SENTIMENT);
  let responseText = '';

  if (dust && sentimentAgentId) {
    try {
      const run = await dust.runAgent(sentimentAgentId, prompt);
      responseText = run.output ?? '';
    } catch (err) {
      childLog.warn({ err }, 'Dust sentiment agent failed, using stub');
    }
  }

  if (!responseText) {
    responseText = JSON.stringify(recordedDealSentiment(activities.length));
  }

  const tokenInput = Math.ceil(prompt.length / 4);
  const tokenOutput = Math.ceil(responseText.length / 4);
  const costMicros = estimateCost(tokenInput, tokenOutput);

  let parsed: {
    score: number | null;
    label: string | null;
    summary: string;
    riskFlags: string[];
    suggestedActions: string[];
  };
  try {
    parsed = JSON.parse(responseText) as typeof parsed;
  } catch {
    parsed = {
      score: null,
      label: null,
      summary: responseText.slice(0, 500),
      riskFlags: [],
      suggestedActions: [],
    };
  }

  const sessionId = await persistSession({
    orgId: opts.orgId,
    userId: opts.userId,
    kind: 'SENTIMENT',
    entityType: 'opportunity',
    entityId: opts.dealId,
    prompt,
    response: responseText,
    tokenInput,
    tokenOutput,
    costMicros,
  });

  await recordCost(opts.orgId, opts.userId, costMicros, childLog);

  return {
    sessionId,
    score: parseDealSentimentScore(parsed.score),
    label: parseDealSentimentLabel(parsed.label),
    summary: parsed.summary ?? '',
    riskFlags: Array.isArray(parsed.riskFlags) ? parsed.riskFlags : [],
    suggestedActions: Array.isArray(parsed.suggestedActions) ? parsed.suggestedActions : [],
    costMicros: Number(costMicros),
  };
}

// ─── Account intel ────────────────────────────────────────────────────────────

/** Counts from recorded deals. No score, and no suggested plays. */
export function recordedAccountIntel(input: {
  opportunityCount: number;
  wonCount: number;
  lostCount: number;
  contactCount: number;
}): {
  healthScore: null;
  summary: string;
  expansionOpportunities: [];
  churnRisks: [];
} {
  return {
    healthScore: null,
    summary: `${input.opportunityCount} opportunities on this account, ${input.wonCount} won, ${input.lostCount} lost, ${input.contactCount} linked contacts. No health score was produced.`,
    expansionOpportunities: [],
    churnRisks: [],
  };
}

/** Keeps a 0–100 model number. Anything else, including a missing field, is no score. */
export function parseAccountHealthScore(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) return null;
  return Math.round(value);
}

// ─── Account intel runner ─────────────────────────────────────────────────────

export async function summarizeAccountIntel(
  opts: { orgId: string; userId: string; accountId: string },
  log: PinoLogger,
): Promise<AccountIntelResult> {
  const childLog = log.child({ feature: 'ai-assistant', action: 'account-intel' });

  const cap = await checkDailyCap(opts.orgId, opts.userId, childLog);
  if (!cap.allowed) {
    throw Object.assign(new Error(cap.reason ?? 'Daily AI cap reached'), {
      statusCode: 429,
      retryAfterSeconds: cap.retryAfterSeconds,
    });
  }

  const { opps, contacts, oppSummary, contactSummary } = await buildAccountIntelContext(
    opts.orgId,
    opts.accountId,
  );

  const prompt =
    `Summarise account health for account ${opts.accountId}.\n` +
    `Opportunities: ${oppSummary || 'none'}.\n` +
    `Contacts: ${contactSummary || 'none'}.\n\n` +
    `Return JSON: {"healthScore":<0-100>,"summary":"...","expansionOpportunities":["..."],"churnRisks":["..."]}`;

  const { client: dust, creds } = await buildDustClient(opts.orgId, childLog);
  const accountIntelAgentId = resolveAgentId(
    creds,
    'accountIntel',
    process.env.DUST_AGENT_ACCOUNT_INTEL,
  );
  let responseText = '';

  if (dust && accountIntelAgentId) {
    try {
      const run = await dust.runAgent(accountIntelAgentId, prompt);
      responseText = run.output ?? '';
    } catch (err) {
      childLog.warn({ err }, 'Dust account-intel agent failed, using stub');
    }
  }

  if (!responseText) {
    const wonCount = opps.filter((o) => String(o.stage) === 'closed_won').length;
    const lostCount = opps.filter((o) => String(o.stage) === 'closed_lost').length;
    const recorded = recordedAccountIntel({
      opportunityCount: opps.length,
      wonCount,
      lostCount,
      contactCount: contacts.length,
    });
    responseText = JSON.stringify(recorded);
  }

  const tokenInput = Math.ceil(prompt.length / 4);
  const tokenOutput = Math.ceil(responseText.length / 4);
  const costMicros = estimateCost(tokenInput, tokenOutput);

  let parsed: {
    healthScore: number | null;
    summary: string;
    expansionOpportunities: string[];
    churnRisks: string[];
  };
  try {
    parsed = JSON.parse(responseText) as typeof parsed;
  } catch {
    parsed = {
      healthScore: null,
      summary: responseText.slice(0, 500),
      expansionOpportunities: [],
      churnRisks: [],
    };
  }

  const sessionId = await persistSession({
    orgId: opts.orgId,
    userId: opts.userId,
    kind: 'DEAL_INSIGHT',
    entityType: 'company',
    entityId: opts.accountId,
    prompt,
    response: responseText,
    tokenInput,
    tokenOutput,
    costMicros,
  });

  await recordCost(opts.orgId, opts.userId, costMicros, childLog);

  return {
    sessionId,
    healthScore: parseAccountHealthScore(parsed.healthScore),
    summary: parsed.summary ?? '',
    expansionOpportunities: Array.isArray(parsed.expansionOpportunities)
      ? parsed.expansionOpportunities
      : [],
    churnRisks: Array.isArray(parsed.churnRisks) ? parsed.churnRisks : [],
    costMicros: Number(costMicros),
  };
}
