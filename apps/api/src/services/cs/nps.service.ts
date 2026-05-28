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
