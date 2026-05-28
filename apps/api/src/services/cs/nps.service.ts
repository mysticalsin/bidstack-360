/**
 * NPS Service — survey dispatch and response handling.
 *
 * WHY signed tokens: NPS response pages are public (no auth). A short-lived
 * signed token prevents replay attacks and cross-survey contamination.
 * Token = HMAC-SHA256(surveyId + expiresAt, NPS_TOKEN_SECRET), stored as
 * a SHA-256 hash in the DB for lookup without exposing the raw token.
 */
import { createHmac, createHash } from 'node:crypto';
import type { Logger as PinoLogger } from 'pino';

import { prisma } from '@bidstack/db';

import { fanOutWebhookEvent } from '../../queues/webhook-delivery.js';
import { sendEmail } from '../email-integration.service.js';

const NPS_TOKEN_SECRET = process.env['NPS_TOKEN_SECRET'] ?? 'change-me-in-production';
const SURVEY_TTL_DAYS = 30;

// ─── Token helpers ─────────────────────────────────────────────────────────

function generateNpsToken(surveyId: string, expiresAt: Date): string {
  const payload = `${surveyId}:${expiresAt.toISOString()}`;
  return createHmac('sha256', NPS_TOKEN_SECRET).update(payload).digest('hex');
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function expiresAt(): Date {
  return new Date(Date.now() + SURVEY_TTL_DAYS * 24 * 60 * 60 * 1000);
}

// ─── Category derivation ───────────────────────────────────────────────────

function deriveCategory(score11: number): 'PROMOTER' | 'PASSIVE' | 'DETRACTOR' {
  if (score11 >= 9) return 'PROMOTER';
  if (score11 >= 7) return 'PASSIVE';
  return 'DETRACTOR';
}

// ─── Public API ────────────────────────────────────────────────────────────

export interface SendNpsSurveyParams {
  orgId: string;
  accountId: string;
  contactId?: string;
}

export interface SendNpsSurveyResult {
  surveyId: string;
  token: string;
  expiresAt: Date;
}

/** Create an NPS survey row and return the signed token for the email link. */
export async function sendNpsSurvey(
  params: SendNpsSurveyParams,
  log: PinoLogger,
): Promise<SendNpsSurveyResult> {
  const { orgId, accountId, contactId } = params;
  const exp = expiresAt();

  // Create survey row first to get the ID for HMAC.
  const survey = await prisma.npsSurvey.create({
    data: {
      orgId,
      accountId,
      contactId,
      tokenHash: 'pending', // placeholder — updated below
      expiresAt: exp,
    },
  });

  const token = generateNpsToken(survey.id, exp);
  const tokenHash = hashToken(token);

  await prisma.npsSurvey.update({
    where: { id: survey.id },
    data: { tokenHash },
  });

  log.info({ orgId, accountId, surveyId: survey.id }, 'cs: NPS survey created');

  // Fan-out webhook so downstream integrations (e.g. Zapier → email) can
  // send the NPS survey link. Fire-and-forget — fail-open, never blocks the caller.
  const appBaseUrl = process.env['APP_BASE_URL'] ?? 'https://app.bidstack.com';
  const publicUrl = `${appBaseUrl}/api/v1/public/nps/${token}`;
  void fanOutWebhookEvent(orgId, 'nps.survey_dispatched', {
    surveyId: survey.id,
    accountId,
    contactId: contactId ?? null,
    publicUrl,
    expiresAt: exp.toISOString(),
  });

  // Also attempt a direct transactional email when the org has a connected
  // email integration. WHY: webhook fan-out covers Zapier/downstream, but
  // direct send provides immediate delivery without requiring setup.
  // Fail-open — never blocks survey creation.
  void sendNpsEmailDirect({ orgId, contactId, surveyId: survey.id, publicUrl, exp }, log);

  return { surveyId: survey.id, token, expiresAt: exp };
}

export interface NpsRespondParams {
  token: string;
  score11: number;
  feedback?: string;
}

export interface NpsRespondResult {
  surveyId: string;
  category: 'PROMOTER' | 'PASSIVE' | 'DETRACTOR';
}

/**
 * Record an NPS response from the public page.
 * Returns the survey ID so the caller can fan-out notifications.
 */
export async function recordNpsResponse(
  params: NpsRespondParams,
  log: PinoLogger,
): Promise<NpsRespondResult> {
  const { token, score11, feedback } = params;
  if (score11 < 0 || score11 > 10) {
    throw new Error('score11 must be 0–10');
  }

  const tokenHash = hashToken(token);
  const survey = await prisma.npsSurvey.findUnique({ where: { tokenHash } });
  if (!survey) throw new Error('Survey not found or token invalid');
  if (survey.expiresAt < new Date()) throw new Error('Survey token expired');
  if (survey.respondedAt) throw new Error('Survey already responded');

  const category = deriveCategory(score11);
  // Net Promoter contribution: promoter=+100, passive=0, detractor=-100
  const score = category === 'PROMOTER' ? 100 : category === 'PASSIVE' ? 0 : -100;

  await prisma.npsSurvey.update({
    where: { id: survey.id },
    data: {
      score,
      score11,
      feedback,
      category,
      respondedAt: new Date(),
    },
  });

  log.info({ surveyId: survey.id, category, score11 }, 'cs: NPS response recorded');
  return { surveyId: survey.id, category };
}

// ─── Direct email dispatch ─────────────────────────────────────────────────

/**
 * Attempt to send the NPS survey link via the org's active email integration.
 * WHY: Provides immediate delivery without requiring Zapier/downstream setup.
 * Silently skips when no contact email or no active integration is available.
 */
async function sendNpsEmailDirect(
  params: {
    orgId: string;
    contactId: string | undefined;
    surveyId: string;
    publicUrl: string;
    exp: Date;
  },
  log: PinoLogger,
): Promise<void> {
  if (!params.contactId) return;

  const contact = await prisma.contact.findFirst({
    where: { id: params.contactId, orgId: params.orgId, deletedAt: null },
    select: { email: true, name: true },
  });
  if (!contact?.email) return;

  // Pick the most-recently-used active email integration for this org.
  const token = await prisma.integrationToken.findFirst({
    where: {
      orgId: params.orgId,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      provider: { in: ['gmail', 'microsoft_graph'] as any[] },
      status: 'active',
      deletedAt: null,
    },
    orderBy: { updatedAt: 'desc' },
    select: { userId: true },
  });
  if (!token) return; // no integration — webhook-only path is fine

  // Use first word of full name as a personal greeting.
  const firstName = contact.name?.split(' ')[0] ?? '';
  const greeting = firstName ? `Hi ${firstName},` : 'Hi,';

  try {
    await sendEmail(
      {
        orgId: params.orgId,
        userId: token.userId,
        to: [{ email: contact.email }],
        subject: 'How are we doing? (2-second survey)',
        html: buildNpsEmailHtml(greeting, params.publicUrl, params.exp),
        text: buildNpsEmailText(greeting, params.publicUrl, params.exp),
        entityType: 'nps_survey',
        entityId: params.surveyId,
      },
      log,
    );
    log.info({ surveyId: params.surveyId, contactId: params.contactId }, 'cs: NPS email sent');
  } catch (err) {
    // WHY fail-open: email failure must never block survey creation.
    log.warn(
      { err, surveyId: params.surveyId },
      'cs: NPS direct email failed (webhook path active)',
    );
  }
}

function buildNpsEmailHtml(greeting: string, publicUrl: string, exp: Date): string {
  const expStr = exp.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /></head>
<body style="margin:0;padding:0;font-family:system-ui,-apple-system,sans-serif;background:#f5f5f7">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f7;padding:40px 0">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;padding:48px 40px;max-width:560px">
        <tr><td>
          <p style="margin:0 0 8px;font-size:15px;color:#1d1d1f">${greeting}</p>
          <p style="margin:0 0 24px;font-size:15px;color:#1d1d1f;line-height:1.6">
            We'd love to hear how we're doing. It only takes a second — just click below to share your score.
          </p>
          <table cellpadding="0" cellspacing="0"><tr><td style="border-radius:10px;background:#0071e3">
            <a href="${publicUrl}" style="display:inline-block;padding:14px 28px;font-size:15px;font-weight:600;color:#fff;text-decoration:none;letter-spacing:-0.01em">
              Share your feedback →
            </a>
          </td></tr></table>
          <p style="margin:24px 0 0;font-size:13px;color:#6e6e73">
            This survey link expires on ${expStr}.
            If the button doesn't work, copy this URL into your browser:<br />
            <span style="color:#0071e3">${publicUrl}</span>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function buildNpsEmailText(greeting: string, publicUrl: string, exp: Date): string {
  const expStr = exp.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
  return [
    greeting,
    '',
    "We'd love to hear how we're doing. It only takes a second.",
    '',
    `Share your feedback: ${publicUrl}`,
    '',
    `This survey link expires on ${expStr}.`,
  ].join('\n');
}

// ─── Quarterly batch ───────────────────────────────────────────────────────

/** Send NPS surveys to all contacts for qualifying accounts (quarterly trigger). */
export async function sendQuarterlyNpsSurveys(orgId: string, log: PinoLogger): Promise<number> {
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

  // Active accounts that haven't had a survey in 90 days.
  const accounts = await prisma.subscription.findMany({
    where: {
      orgId,
      status: 'ACTIVE',
      NOT: {
        account: {
          npsSurveys: { some: { sentAt: { gte: ninetyDaysAgo } } },
        },
      },
    },
    select: {
      accountId: true,
      account: { select: { contacts: { select: { id: true }, take: 1 } } },
    },
    distinct: ['accountId'],
  });

  let dispatched = 0;
  for (const sub of accounts) {
    const contactId = sub.account.contacts[0]?.id;
    await sendNpsSurvey({ orgId, accountId: sub.accountId, contactId }, log);
    dispatched++;
  }

  log.info({ orgId, dispatched }, 'cs: quarterly NPS surveys dispatched');
  return dispatched;
}
