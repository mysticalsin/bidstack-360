/**
 * ai-assistant.email.service.ts — email draft pipeline.
 *
 * Extracted from ai-assistant.service.ts (BS-R1 file-size refactor).
 * Import DAG: helpers (leaf) ← context ← this file.
 */
import type { Logger as PinoLogger } from 'pino';

import {
  type EmailDraft,
  type EmailDraftInput,
  type EmailDraftResult,
  buildDustClient,
  resolveAgentId,
  checkDailyCap,
  completeChatOrNull,
  estimateCost,
  persistSession,
  recordCost,
} from './ai-assistant.helpers.js';
import { buildEmailDraftContext } from './ai-assistant.context.js';

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

  const { client: dust, creds } = await buildDustClient(input.orgId, childLog);
  const emailDraftAgentId = resolveAgentId(creds, 'emailDraft', process.env.DUST_AGENT_EMAIL_DRAFT);
  let responseText = '';

  if (dust && emailDraftAgentId) {
    try {
      const run = await dust.runAgent(emailDraftAgentId, prompt);
      responseText = run.output ?? '';
    } catch (err) {
      childLog.warn({ err }, 'Dust email-draft agent failed, using stub');
    }
  }

  // OmniRoute (free, keyless gateway) powers the copilot when Dust isn't
  // configured; the static stub below is the last resort, only reached if
  // no direct LLM resolves either.
  if (!responseText) {
    const direct = await completeChatOrNull(
      input.orgId,
      { user: prompt, responseFormat: 'json_object' },
      childLog,
    );
    if (direct) responseText = direct;
  }

  // Stub fallback (Dust not configured, direct LLM unavailable, or both failed).
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
