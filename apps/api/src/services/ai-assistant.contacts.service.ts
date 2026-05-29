/**
 * ai-assistant.contacts.service.ts — contact enrichment + meeting prep pipelines.
 *
 * Extracted from ai-assistant.service.ts (BS-R1 file-size refactor).
 * Import DAG: helpers (leaf) ← context ← this file.
 */
import type { Logger as PinoLogger } from 'pino';

import {
  type ContactEnrichResult,
  type MeetingPrepResult,
  buildDustClient,
  checkDailyCap,
  estimateCost,
  persistSession,
  recordCost,
} from './ai-assistant.helpers.js';
import { buildEnrichContext, buildMeetingContext } from './ai-assistant.context.js';

// ─── Meeting prep ─────────────────────────────────────────────────────────────

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

// ─── Contact enrichment ───────────────────────────────────────────────────────

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
