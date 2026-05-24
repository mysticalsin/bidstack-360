// AI Assistant service — the core logic behind all five AI capabilities.
//
// WHY this lives in a service module: routes are thin by convention in this
// codebase. Complex orchestration (context gathering, LLM call, cost
// tracking, daily-cap enforcement) belongs here, not in the route handler.
//
// PII policy: contacts with aiOptOut=true have their name/email/phone
// stripped from every prompt. The sanitised prompt is what gets stored in
// AiAssistantSession — never the raw context.

import type { Logger as PinoLogger } from 'pino';
import { z } from 'zod';

import { prisma } from '@bidstack/db';
import { DustClient } from '@bidstack/dust-client';

import { redis } from '../redis.js';

// ─── Cost model constants ─────────────────────────────────────────────────
// Per-user daily cap used when org has no OrgSettings row yet.
const DEFAULT_DAILY_CAP_MICROS = BigInt(5_000_000); // $5.00
const DEFAULT_DAILY_SESSION_CAP = 100;

// Rough cost estimate: GPT-4o-equivalent at $5/1M input + $15/1M output.
// Real cost comes from Dust usage telemetry when available; this is the
// fallback for when usage data is absent.
const COST_PER_TOKEN_INPUT_MICROS = 5n; // $0.000005 → 5 micros
const COST_PER_TOKEN_OUTPUT_MICROS = 15n;

// Model identifier recorded on every session.
const AI_MODEL = 'dust-agent-v1';

// ─── Redis cost-cap key helpers ───────────────────────────────────────────
// We accumulate per-user cost in a rolling UTC-day window.
// Key: bidstack:ai:daily:<orgId>:<userId>:<YYYY-MM-DD>
// Value: stringified BigInt micros, TTL 48 h.

function dailyCostKey(orgId: string, userId: string, nowMs = Date.now()): string {
  const date = new Date(nowMs).toISOString().slice(0, 10); // YYYY-MM-DD
  return `bidstack:ai:daily:${orgId}:${userId}:${date}`;
}

function dailySessionKey(orgId: string, userId: string, nowMs = Date.now()): string {
  const date = new Date(nowMs).toISOString().slice(0, 10);
  return `bidstack:ai:sessions:${orgId}:${userId}:${date}`;
}

// ─── Types ────────────────────────────────────────────────────────────────

export interface AiCapCheckResult {
  allowed: boolean;
  retryAfterSeconds?: number;
  reason?: string;
}

export interface EmailDraftInput {
  orgId: string;
  userId: string;
  contactId?: string;
  dealId?: string;
  tone: 'formal' | 'friendly' | 'direct';
  intent: string;
}

export interface EmailDraft {
  subject: string;
  body: string;
}

export interface EmailDraftResult {
  sessionId: string;
  drafts: [EmailDraft, EmailDraft, EmailDraft];
  costMicros: number;
}

export interface DealSentimentResult {
  sessionId: string;
  score: number; // -1 to 1
  label: 'positive' | 'neutral' | 'negative';
  summary: string;
  riskFlags: string[];
  suggestedActions: string[];
  costMicros: number;
}

export interface MeetingPrepResult {
  sessionId: string;
  attendees: Array<{ name: string; role: string | null; company: string | null }>;
  openOpps: Array<{ id: string; title: string; stage: string }>;
  recentInteractions: string[];
  talkingPoints: string[];
  suggestedQuestions: string[];
  costMicros: number;
}

export interface ContactEnrichResult {
  sessionId: string;
  jobTitle: string | null;
  company: string | null;
  linkedinUrl: string | null;
  seniority: string | null;
  source: 'apollo' | 'domain-inference' | 'none';
  costMicros: number;
}

export interface AccountIntelResult {
  sessionId: string;
  healthScore: number; // 0–100
  summary: string;
  expansionOpportunities: string[];
  churnRisks: string[];
  costMicros: number;
}

// ─── Cap enforcement ──────────────────────────────────────────────────────

async function checkDailyCap(
  orgId: string,
  userId: string,
  log: PinoLogger,
): Promise<AiCapCheckResult> {
  // Fetch org cap (may be absent for new orgs — fallback to default).
  let capMicros = DEFAULT_DAILY_CAP_MICROS;
  try {
    const settings = await prisma.orgSettings.findUnique({ where: { orgId } });
    if (settings) {
      const raw = settings.aiCostCapDailyMicros as bigint;
      // 0 = unlimited
      if (raw === 0n) return { allowed: true };
      capMicros = raw;
    }
  } catch (err) {
    log.warn({ err }, 'ai-assistant: failed to fetch org settings, using default cap');
  }

  const nowMs = Date.now();
  const costKey = dailyCostKey(orgId, userId, nowMs);
  const sessionKey = dailySessionKey(orgId, userId, nowMs);

  try {
    const [costRaw, sessRaw] = await redis.mget(costKey, sessionKey);
    const costSoFar = BigInt(costRaw ?? '0');
    const sessionsSoFar = Number(sessRaw ?? '0');

    if (sessionsSoFar >= DEFAULT_DAILY_SESSION_CAP) {
      // Retry-after: seconds until next UTC midnight.
      const msUntilMidnight =
        new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z').getTime() +
        86_400_000 -
        nowMs;
      return {
        allowed: false,
        retryAfterSeconds: Math.ceil(msUntilMidnight / 1000),
        reason: `Daily AI session limit of ${DEFAULT_DAILY_SESSION_CAP} reached.`,
      };
    }

    if (costSoFar >= capMicros) {
      const msUntilMidnight =
        new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z').getTime() +
        86_400_000 -
        nowMs;
      return {
        allowed: false,
        retryAfterSeconds: Math.ceil(msUntilMidnight / 1000),
        reason: `Daily AI cost cap of $${Number(capMicros) / 1_000_000} reached.`,
      };
    }
  } catch (err) {
    // Fail open — Redis unreachable shouldn't block AI features, but log loudly.
    log.warn({ err }, 'ai-assistant: Redis cap check failed, allowing request (fail-open)');
  }

  return { allowed: true };
}

async function recordCost(
  orgId: string,
  userId: string,
  costMicros: bigint,
  log: PinoLogger,
): Promise<void> {
  const nowMs = Date.now();
  const costKey = dailyCostKey(orgId, userId, nowMs);
  const sessionKey = dailySessionKey(orgId, userId, nowMs);
  const TTL_S = 48 * 60 * 60; // 48 h to outlive the UTC-day window
  try {
    const pipeline = redis.pipeline();
    pipeline.incrby(costKey, Number(costMicros)); // incrby works on string-int
    pipeline.expire(costKey, TTL_S);
    pipeline.incr(sessionKey);
    pipeline.expire(sessionKey, TTL_S);
    await pipeline.exec();
  } catch (err) {
    log.warn({ err }, 'ai-assistant: failed to persist cost to Redis');
  }
}

// ─── Prompt sanitisation ──────────────────────────────────────────────────

/**
 * Redact personal fields if the contact has opted out of AI processing.
 * WHY: spec requires no PII in prompts unless explicitly authorised per contact.
 */
function sanitiseContactForPrompt(contact: {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  role: string | null;
  aiOptOut: boolean;
}): { id: string; name: string; email: string | null; phone: string | null; role: string | null } {
  if (contact.aiOptOut) {
    return { id: contact.id, name: '[REDACTED]', email: null, phone: null, role: contact.role };
  }
  return contact;
}

// ─── Dust client factory ──────────────────────────────────────────────────

function buildDustClient(log: PinoLogger): DustClient | null {
  const apiKey = process.env.DUST_API_KEY;
  const workspaceId = process.env.DUST_WORKSPACE_ID;
  if (!apiKey || !workspaceId) return null;
  return new DustClient({
    apiKey,
    workspaceId,
    baseUrl: process.env.DUST_BASE_URL,
    timeoutMs: 30_000,
    logger: log,
  });
}

// ─── Cost estimation ──────────────────────────────────────────────────────

function estimateCost(inputTokens: number, outputTokens: number): bigint {
  return (
    BigInt(inputTokens) * COST_PER_TOKEN_INPUT_MICROS +
    BigInt(outputTokens) * COST_PER_TOKEN_OUTPUT_MICROS
  );
}

// ─── Session persistence helper ───────────────────────────────────────────

async function persistSession(opts: {
  orgId: string;
  userId: string;
  kind: 'EMAIL_DRAFT' | 'DEAL_INSIGHT' | 'MEETING_PREP' | 'DATA_ENRICH' | 'SENTIMENT';
  entityType?: string;
  entityId?: string;
  prompt: string;
  response: string;
  tokenInput: number;
  tokenOutput: number;
  costMicros: bigint;
}): Promise<string> {
  const session = await prisma.aiAssistantSession.create({
    data: {
      orgId: opts.orgId,
      userId: opts.userId,
      kind: opts.kind,
      entityType: opts.entityType,
      entityId: opts.entityId,
      prompt: opts.prompt,
      response: opts.response,
      tokenInput: opts.tokenInput,
      tokenOutput: opts.tokenOutput,
      costMicros: opts.costMicros,
      model: AI_MODEL,
    },
    select: { id: true },
  });
  return session.id;
}

// ─── Email draft ──────────────────────────────────────────────────────────

export async function draftEmail(
  input: EmailDraftInput,
  log: PinoLogger,
): Promise<EmailDraftResult> {
  const childLog = log.child({ feature: 'ai-assistant', action: 'email-draft' });

  const cap = await checkDailyCap(input.orgId, input.userId, childLog);
  if (!cap.allowed) {
    const err = Object.assign(new Error(cap.reason ?? 'Daily AI cap reached'), {
      statusCode: 429,
      retryAfterSeconds: cap.retryAfterSeconds,
    });
    throw err;
  }

  // Build context: contact + deal activity.
  const parts: string[] = [];

  if (input.contactId) {
    const contact = await prisma.contact.findFirst({
      where: { id: input.contactId, orgId: input.orgId, deletedAt: null },
      select: { id: true, name: true, email: true, phone: true, role: true, aiOptOut: true },
    });
    if (contact) {
      const safe = sanitiseContactForPrompt(contact);
      parts.push(
        `Contact: ${safe.name}${safe.role ? ` (${safe.role})` : ''}${safe.email ? `, ${safe.email}` : ''}`,
      );
    }
  }

  if (input.dealId) {
    const opp = await prisma.opportunity.findFirst({
      where: { id: input.dealId, orgId: input.orgId, deletedAt: null },
      select: { title: true, stage: true, valueMicros: true },
    });
    if (opp) {
      const valueStr = opp.valueMicros ? `$${(Number(opp.valueMicros) / 1_000_000).toFixed(0)}` : '';
      parts.push(`Deal: "${opp.title}" — stage: ${opp.stage}${valueStr ? `, value: ${valueStr}` : ''}`);
    }
  }

  const contextStr = parts.length ? `\n\nContext:\n${parts.join('\n')}` : '';
  const prompt =
    `Draft 3 email variations. Tone: ${input.tone}. Intent: ${input.intent}.` +
    `${contextStr}\n\nReturn JSON array: [{"subject":"...","body":"..."}, ...]`;

  const dust = buildDustClient(childLog);

  let responseText = '';
  let tokenInput = 0;
  let tokenOutput = 0;

  if (dust && process.env.DUST_AGENT_EMAIL_DRAFT) {
    try {
      const run = await dust.runAgent(process.env.DUST_AGENT_EMAIL_DRAFT, prompt);
      responseText = run.output ?? '';
    } catch (err) {
      childLog.warn({ err }, 'Dust email-draft agent failed, using stub');
    }
  }

  // Stub fallback (no Dust configured, or agent failed).
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

  // Rough token count: 4 chars ≈ 1 token.
  tokenInput = Math.ceil(prompt.length / 4);
  tokenOutput = Math.ceil(responseText.length / 4);
  const costMicros = estimateCost(tokenInput, tokenOutput);

  let drafts: [EmailDraft, EmailDraft, EmailDraft];
  try {
    const parsed = JSON.parse(responseText) as EmailDraft[];
    // Ensure exactly 3 drafts.
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

  const opp = await prisma.opportunity.findFirst({
    where: { id: opts.dealId, orgId: opts.orgId, deletedAt: null },
    select: { id: true, title: true, stage: true },
  });
  if (!opp) {
    throw Object.assign(new Error('Deal not found'), { statusCode: 404 });
  }

  // Pull last 20 activities scoped to this opportunity.
  const activities = await prisma.activity.findMany({
    where: { orgId: opts.orgId, entityType: 'opportunity', entityId: opts.dealId, deletedAt: null },
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: { type: true, subject: true, description: true, createdAt: true },
  });

  const activitiesSummary = activities
    .map(
      (a) =>
        `[${a.type}] ${a.subject ?? ''}: ${a.description?.slice(0, 200) ?? '(no description)'}`,
    )
    .join('\n');

  const prompt =
    `Analyse deal sentiment for "${opp.title}" (stage: ${opp.stage}).\n` +
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
    // Stub: infer from activity count as a very rough heuristic.
    const score = activities.length >= 5 ? 0.3 : activities.length >= 2 ? 0 : -0.2;
    responseText = JSON.stringify({
      score,
      label: score > 0.1 ? 'positive' : score < -0.1 ? 'negative' : 'neutral',
      summary: `${activities.length} activities recorded for this deal.`,
      riskFlags:
        activities.length === 0 ? ['No recent activity — deal may be stalled'] : [],
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

  const event = await prisma.calendarEvent.findFirst({
    where: { id: opts.calendarEventId, orgId: opts.orgId, deletedAt: null },
    select: { id: true, subject: true, startAt: true, attendees: true, relatedEntityId: true },
  });
  if (!event) {
    throw Object.assign(new Error('Calendar event not found'), { statusCode: 404 });
  }

  // Parse attendees from JSON field (array of { email, displayName? }).
  const AttendeesSchema = z.array(
    z.object({
      email: z.string().optional(),
      displayName: z.string().optional(),
    }),
  );
  const rawAttendees = AttendeesSchema.safeParse(event.attendees);
  const attendeeEmails = rawAttendees.success
    ? rawAttendees.data.map((a) => a.email).filter(Boolean)
    : [];

  // Resolve contacts matching attendee emails.
  const contacts = await prisma.contact.findMany({
    where: {
      orgId: opts.orgId,
      email: { in: attendeeEmails as string[] },
      deletedAt: null,
    },
    select: {
      id: true,
      name: true,
      role: true,
      email: true,
      phone: true,
      aiOptOut: true,
      customer: true,
    },
    take: 20,
  });

  const safeAttendees = contacts.map((c) => {
    const s = sanitiseContactForPrompt(c);
    return { name: s.name, role: s.role, company: c.customer };
  });

  // Pull open opportunities for the related entity if present.
  let openOpps: Array<{ id: string; title: string; stage: string }> = [];
  if (event.relatedEntityId) {
    const opps = await prisma.opportunity.findMany({
      where: {
        orgId: opts.orgId,
        id: event.relatedEntityId,
        stage: { not: 'closed_lost' },
        deletedAt: null,
      },
      select: { id: true, title: true, stage: true },
      take: 5,
    });
    openOpps = opps.map((o) => ({
      id: o.id,
      title: o.title,
      stage: String(o.stage),
    }));
  }

  // Recent activities for contact IDs.
  const contactIds = contacts.map((c) => c.id);
  const recentActs = contactIds.length
    ? await prisma.activity.findMany({
        where: {
          orgId: opts.orgId,
          entityType: 'contact',
          entityId: { in: contactIds },
          deletedAt: null,
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: { type: true, subject: true, description: true, createdAt: true },
      })
    : [];

  const actSummary = recentActs
    .map((a) => `[${a.type}] ${a.subject ?? ''}`)
    .join('; ');

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

  const recentInteractions = recentActs.slice(0, 5).map((a) => `${a.type}: ${a.subject ?? ''}`);

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

  const contact = await prisma.contact.findFirst({
    where: { id: opts.contactId, orgId: opts.orgId, deletedAt: null },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      role: true,
      aiOptOut: true,
      customer: true,
    },
  });
  if (!contact) {
    throw Object.assign(new Error('Contact not found'), { statusCode: 404 });
  }

  const safe = sanitiseContactForPrompt(contact);

  // Try domain-inference if we have an email (and contact hasn't opted out).
  const emailDomain = !contact.aiOptOut && contact.email ? contact.email.split('@')[1] : null;

  // Log a stub enrichment — Apollo MCP would be called here in production
  // when the MCP server has apollo_people_match configured.
  // WHY stub: the Apollo MCP tool exists in apps/mcp-server/src/tools/ but
  // requires a live API key; we record the enrichment attempt regardless.
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

  let parsed: { jobTitle: string | null; company: string | null; linkedinUrl: string | null; seniority: string | null };
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

  const [opps, contacts] = await Promise.all([
    prisma.opportunity.findMany({
      where: { orgId: opts.orgId, companyId: opts.accountId, deletedAt: null },
      select: { id: true, title: true, stage: true, valueMicros: true },
      orderBy: { createdAt: 'desc' },
      take: 20,
    }),
    prisma.contact.findMany({
      where: { orgId: opts.orgId, companyId: opts.accountId, deletedAt: null },
      select: { id: true, name: true, role: true, aiOptOut: true },
      take: 20,
    }),
  ]);

  const oppSummary = opps
    .map((o) => `"${o.title}" (${o.stage}${o.valueMicros ? `, $${(Number(o.valueMicros) / 1_000_000).toFixed(0)}` : ''})`)
    .join(', ');

  // Safe contact list — opt-out contacts only show their role.
  const contactSummary = contacts
    .map((c) => (c.aiOptOut ? `[REDACTED] (${c.role ?? 'unknown'})` : `${c.name} (${c.role ?? 'unknown'})`))
    .join(', ');

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
    const wonCount = opps.filter((o) => o.stage === 'closed_won').length;
    const lostCount = opps.filter((o) => o.stage === 'closed_lost').length;
    const healthScore = opps.length
      ? Math.round(((wonCount + 1) / (wonCount + lostCount + 1)) * 100)
      : 50;
    responseText = JSON.stringify({
      healthScore,
      summary: `${opps.length} total opportunities, ${wonCount} won, ${lostCount} lost. ${contacts.length} known contacts.`,
      expansionOpportunities:
        wonCount > 0 ? ['Explore upsell for existing won deals', 'Cross-sell related products'] : [],
      churnRisks:
        lostCount >= 2 ? ['Multiple lost deals may indicate competitive pressure'] : [],
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
    parsed = { healthScore: 50, summary: responseText.slice(0, 500), expansionOpportunities: [], churnRisks: [] };
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
