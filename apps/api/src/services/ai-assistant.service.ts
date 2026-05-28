/**
 * ai-assistant.service.ts — AI feature orchestrator.
 *
 * Each exported function follows the same pipeline:
 *   1. Cap check (daily cost + session limit via Redis)
 *   2. Build context (Prisma queries via ai-assistant.context.ts)
 *   3. Assemble prompt string
 *   4. Call Dust agent (or fall back to a deterministic stub)
 *   5. Parse JSON response (with safe fallback)
 *   6. Persist AiAssistantSession row
 *   7. Record cost in Redis
 *   8. Return typed result
 *
 * PII policy: contacts with aiOptOut=true have their name/email/phone
 * stripped before the prompt is built. The sanitised prompt is stored in
 * AiAssistantSession — never the raw context.
 *
 * Import DAG: helpers (leaf) ← context ← this file (orchestrator).
 */
import type { Logger as PinoLogger } from 'pino';

import {
  type AccountIntelResult,
  type ContactEnrichResult,
  type DealSentimentResult,
  type EmailDraft,
  type EmailDraftInput,
  type EmailDraftResult,
  type MeetingPrepResult,
  buildDustClient,
  checkDailyCap,
  estimateCost,
  persistSession,
  recordCost,
} from './ai-assistant.helpers.js';
import {
  buildAccountIntelContext,
  buildEmailDraftContext,
  buildEnrichContext,
  buildMeetingContext,
  buildSentimentContext,
} from './ai-assistant.context.js';

// ─── Email draft ──────────────────────────────────────────────────────────

export async function draftEmail(
  input: EmailDraftInput,
  log: PinoLogger,
): Promise<EmailDraftResult> {
  const childLog = log.child({ feature: 'ai-assistant', action: 'email-draft' });

  const cap = await checkDailyCap(input.orgId, input.userId, childLog);
  if (!cap.allowed) {
    throw Object.assign(new Error(cap.reason ?? 'Daily AI cap reached'), {
      statusCode: 429,
      retryAfterSeconds: cap.retryAfterSeconds,
    });
  }

  const { contextStr } = await buildEmailDraftContext(input.orgId, input.contactId, input.dealId);
  const prompt =
    `Draft 3 email variations. Tone: ${input.tone}. Intent: ${input.intent}.` +
    `${contextStr}\n\nReturn JSON array: [{"subject":"...","body":"..."}, ...]`;

  const dust = buildDustClient(childLog);
  let responseText = '';

  if (dust && process.env.DUST_AGENT_EMAIL_DRAFT) {
    try {
      const run = await dust.runAgent(process.env.DUST_AGENT_EMAIL_DRAFT, prompt);
      responseText = run.output ?? '';
    } catch (err) {
      childLog.warn({ err }, 'Dust email-draft agent failed, using stub');
    }
  }

  // Stub fallback (Dust not configured, or agent call failed).
  if (!responseText) {
    const tonedSalutation =
      input.tone === 'formal'
        ? 'I hope this message finds you well.'
        : input.tone === 'friendly'
          ? 'Hope you are doing great!'
          : 'Quick note:';
    responseText = JSON.stringify([
      {
        subject: `[Draft 1] ${input.intent}`,
        body: `${tonedSalutation}\n\n${input.intent}\n\nBest regards`,
      },
      {
        subject: `[Draft 2] Re: ${input.intent}`,
        body: `${tonedSalutation}\n\nFollowing up on ${input.intent}.\n\nWarm regards`,
      },
      {
        subject: `[Draft 3] ${input.intent} — follow-up`,
        body: `${tonedSalutation}\n\nI wanted to touch base regarding ${input.intent}.\n\nBest`,
      },
    ]);
  }

  const tokenInput = Math.ceil(prompt.length / 4);
  const tokenOutput = Math.ceil(responseText.length / 4);
  const costMicros = estimateCost(tokenInput, tokenOutput);

  // Ensure exactly 3 drafts regardless of model output.
  let drafts: [EmailDraft, EmailDraft, EmailDraft];
  try {
    const parsed = JSON.parse(responseText) as EmailDraft[];
    const three = parsed.slice(0, 3);
    while (three.length < 3)
      three.push({ subject: `[Draft ${three.length + 1}] ${input.intent}`, body: '' });
    drafts = three as [EmailDraft, EmailDraft, EmailDraft];
  } catch {
    drafts = [
      { subject: `[Draft 1] ${input.intent}`, body: responseText },
      { subject: `[Draft 2] ${input.intent}`, body: '' },
      { subject: `[Draft 3] ${input.intent}`, body: '' },
    ];
  }

  const sessionId = await persistSession({
    orgId: input.orgId,
    userId: input.userId,
    kind: 'EMAIL_DRAFT',
    entityType: input.contactId ? 'contact' : input.dealId ? 'opportunity' : undefined,
    entityId: input.contactId ?? input.dealId,
    prompt,
    response: responseText,
    tokenInput,
    tokenOutput,
    costMicros,
  });

  await recordCost(input.orgId, input.userId, costMicros, childLog);
  return { sessionId, drafts, costMicros: Number(costMicros) };
}

// ─── Deal sentiment ───────────────────────────────────────────────────────

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

  const dust = buildDustClient(childLog);
  let responseText = '';

  if (dust && process.env.DUST_AGENT_SENTIMENT) {
    try {
      const run = await dust.runAgent(process.env.DUST_AGENT_SENTIMENT, prompt);
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

// ─── Meeting prep ─────────────────────────────────────────────────────────

export async function prepMeeting(
  opts: { orgId: string; userId: string; calendarEventId: string },
  log: PinoLogger,
): Promise<MeetingPrepResult> {
  const childLog = log.child({ feature: 'ai-assistant', action: 'meeting-prep' });

  const cap = await checkDailyCap(opts.orgId, opts.userId, childLog);
  if (!cap.allowed) {
    throw Object.assign(new Error(cap.reason ?? 'Daily AI cap reached'), {
      statusCode: 429,
      retryAfterSeconds: cap.retryAfterSeconds,
    });
  }

  const { event, safeAttendees, openOpps, recentInteractions, actSummary } =
    await buildMeetingContext(opts.orgId, opts.calendarEventId);

  const prompt =
    `Prepare meeting brief for: "${event.subject}" on ${event.startAt.toISOString()}.\n` +
    `Attendees: ${safeAttendees.map((a) => `${a.name} (${a.role ?? 'unknown'}) from ${a.company ?? 'unknown'}`).join(', ') || 'unknown'}.\n` +
    `Open deals: ${openOpps.map((o) => `"${o.title}" (${o.stage})`).join(', ') || 'none'}.\n` +
    `Recent interactions: ${actSummary || 'none'}.\n\n` +
    `Return JSON: {"talkingPoints":["..."],"suggestedQuestions":["..."]}`;

  const dust = buildDustClient(childLog);
  let responseText = '';

  if (dust && process.env.DUST_AGENT_MEETING_PREP) {
    try {
      const run = await dust.runAgent(process.env.DUST_AGENT_MEETING_PREP, prompt);
      responseText = run.output ?? '';
    } catch (err) {
      childLog.warn({ err }, 'Dust meeting-prep agent failed, using stub');
    }
  }

  if (!responseText) {
    responseText = JSON.stringify({
      talkingPoints: [
        openOpps.length
          ? `Review status of "${openOpps[0]?.title}" deal`
          : 'Discuss relationship objectives',
        'Confirm next steps and timeline',
        'Address any open questions',
      ],
      suggestedQuestions: [
        'What are the key decision criteria?',
        'Are there any blockers we should know about?',
        'What does success look like for you?',
      ],
    });
  }

  const tokenInput = Math.ceil(prompt.length / 4);
  const tokenOutput = Math.ceil(responseText.length / 4);
  const costMicros = estimateCost(tokenInput, tokenOutput);

  let parsed: { talkingPoints: string[]; suggestedQuestions: string[] };
  try {
    parsed = JSON.parse(responseText) as typeof parsed;
  } catch {
    parsed = { talkingPoints: [], suggestedQuestions: [] };
  }

  const sessionId = await persistSession({
    orgId: opts.orgId,
    userId: opts.userId,
    kind: 'MEETING_PREP',
    entityType: 'calendar_event',
    entityId: opts.calendarEventId,
    prompt,
    response: responseText,
    tokenInput,
    tokenOutput,
    costMicros,
  });

  await recordCost(opts.orgId, opts.userId, costMicros, childLog);

  return {
    sessionId,
    attendees: safeAttendees,
    openOpps,
    recentInteractions,
    talkingPoints: Array.isArray(parsed.talkingPoints) ? parsed.talkingPoints : [],
    suggestedQuestions: Array.isArray(parsed.suggestedQuestions) ? parsed.suggestedQuestions : [],
    costMicros: Number(costMicros),
  };
}

// ─── Contact enrichment ───────────────────────────────────────────────────

export async function enrichContact(
  opts: { orgId: string; userId: string; contactId: string },
  log: PinoLogger,
): Promise<ContactEnrichResult> {
  const childLog = log.child({ feature: 'ai-assistant', action: 'enrich-contact' });

  const cap = await checkDailyCap(opts.orgId, opts.userId, childLog);
  if (!cap.allowed) {
    throw Object.assign(new Error(cap.reason ?? 'Daily AI cap reached'), {
      statusCode: 429,
      retryAfterSeconds: cap.retryAfterSeconds,
    });
  }

  const { contact, safe, emailDomain } = await buildEnrichContext(opts.orgId, opts.contactId);

  // WHY stub comment: Apollo MCP exists in mcp-server/src/tools/ but needs a
  // live API key. We record the attempt regardless so cost tracking is accurate.
  const prompt =
    `Enrich contact: name="${safe.name}", company="${contact.customer}", ` +
    `email domain="${emailDomain ?? 'unknown'}".\n` +
    `Return JSON: {"jobTitle":"...","company":"...","linkedinUrl":"...","seniority":"..."}`;

  const dust = buildDustClient(childLog);
  let responseText = '';
  let enrichSource: 'apollo' | 'domain-inference' | 'none' = 'none';

  if (dust && process.env.DUST_AGENT_ENRICH) {
    try {
      const run = await dust.runAgent(process.env.DUST_AGENT_ENRICH, prompt);
      responseText = run.output ?? '';
      enrichSource = 'domain-inference';
    } catch (err) {
      childLog.warn({ err }, 'Dust enrich agent failed, using stub');
    }
  }

  if (!responseText) {
    responseText = JSON.stringify({
      jobTitle: contact.role ?? null,
      company: contact.customer,
      linkedinUrl: emailDomain ? `https://linkedin.com/company/${emailDomain.split('.')[0]}` : null,
      seniority: null,
    });
  }

  const tokenInput = Math.ceil(prompt.length / 4);
  const tokenOutput = Math.ceil(responseText.length / 4);
  const costMicros = estimateCost(tokenInput, tokenOutput);

  let parsed: {
    jobTitle: string | null;
    company: string | null;
    linkedinUrl: string | null;
    seniority: string | null;
  };
  try {
    parsed = JSON.parse(responseText) as typeof parsed;
  } catch {
    parsed = { jobTitle: null, company: null, linkedinUrl: null, seniority: null };
  }

  const sessionId = await persistSession({
    orgId: opts.orgId,
    userId: opts.userId,
    kind: 'DATA_ENRICH',
    entityType: 'contact',
    entityId: opts.contactId,
    prompt,
    response: responseText,
    tokenInput,
    tokenOutput,
    costMicros,
  });

  await recordCost(opts.orgId, opts.userId, costMicros, childLog);

  return {
    sessionId,
    jobTitle: parsed.jobTitle,
    company: parsed.company,
    linkedinUrl: parsed.linkedinUrl,
    seniority: parsed.seniority,
    source: enrichSource,
    costMicros: Number(costMicros),
  };
}

// ─── Account intel ────────────────────────────────────────────────────────

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

  const dust = buildDustClient(childLog);
  let responseText = '';

  if (dust && process.env.DUST_AGENT_ACCOUNT_INTEL) {
    try {
      const run = await dust.runAgent(process.env.DUST_AGENT_ACCOUNT_INTEL, prompt);
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
