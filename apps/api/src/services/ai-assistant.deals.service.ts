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
    // Stub: infer rough sentiment from activity count as a simple heuristic.
    const score = activities.length >= 5 ? 0.3 : activities.length >= 2 ? 0 : -0.2;
    responseText = JSON.stringify({
      score,
      label: score > 0.1 ? 'positive' : score < -0.1 ? 'negative' : 'neutral',
      summary: `${activities.length} activities recorded for this deal.`,
      riskFlags: activities.length === 0 ? ['No recent activity — deal may be stalled'] : [],
      suggestedActions:
        activities.length === 0
          ? ['Schedule a follow-up call', 'Send a check-in email']
          : ['Review latest activity for next steps'],
    });
  }

  const tokenInput = Math.ceil(prompt.length / 4);
  const tokenOutput = Math.ceil(responseText.length / 4);
  const costMicros = estimateCost(tokenInput, tokenOutput);

  let parsed: {
    score: number;
    label: string;
    summary: string;
    riskFlags: string[];
    suggestedActions: string[];
  };
  try {
    parsed = JSON.parse(responseText) as typeof parsed;
  } catch {
    parsed = {
      score: 0,
      label: 'neutral',
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
    score: parsed.score ?? 0,
    label: (parsed.label as 'positive' | 'neutral' | 'negative') ?? 'neutral',
    summary: parsed.summary ?? '',
    riskFlags: Array.isArray(parsed.riskFlags) ? parsed.riskFlags : [],
    suggestedActions: Array.isArray(parsed.suggestedActions) ? parsed.suggestedActions : [],
    costMicros: Number(costMicros),
  };
}

// ─── Account intel ────────────────────────────────────────────────────────────

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
    const healthScore = opps.length
      ? Math.round(((wonCount + 1) / (wonCount + lostCount + 1)) * 100)
      : 50;
    responseText = JSON.stringify({
      healthScore,
      summary: `${opps.length} total opportunities, ${wonCount} won, ${lostCount} lost. ${contacts.length} known contacts.`,
      expansionOpportunities:
        wonCount > 0
          ? ['Explore upsell for existing won deals', 'Cross-sell related products']
          : [],
      churnRisks: lostCount >= 2 ? ['Multiple lost deals may indicate competitive pressure'] : [],
    });
  }

  const tokenInput = Math.ceil(prompt.length / 4);
  const tokenOutput = Math.ceil(responseText.length / 4);
  const costMicros = estimateCost(tokenInput, tokenOutput);

  let parsed: {
    healthScore: number;
    summary: string;
    expansionOpportunities: string[];
    churnRisks: string[];
  };
  try {
    parsed = JSON.parse(responseText) as typeof parsed;
  } catch {
    parsed = {
      healthScore: 50,
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
    healthScore: parsed.healthScore ?? 50,
    summary: parsed.summary ?? '',
    expansionOpportunities: Array.isArray(parsed.expansionOpportunities)
      ? parsed.expansionOpportunities
      : [],
    churnRisks: Array.isArray(parsed.churnRisks) ? parsed.churnRisks : [],
    costMicros: Number(costMicros),
  };
}
