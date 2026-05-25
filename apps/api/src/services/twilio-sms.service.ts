/**
 * Twilio SMS service — send, receive, consent, status webhooks.
 *
 * WHY a service layer: both the API route (send) and the BullMQ worker
 * (bulk-send cadences) share the same Twilio REST call, consent check, and
 * Activity log write. Extracting here keeps routes/workers thin.
 *
 * Design decisions:
 *  - Consent check is synchronous before every send — TCPA non-negotiable.
 *  - Twilio credentials stored via IntegrationToken (provider=twilio).
 *    accessTokenEncrypted holds JSON: { accountSid, authToken }.
 *  - Webhook signature validated with timingSafeEqual (constant-time).
 *  - STOP keyword matching is case-insensitive per CTIA/TCPA guidance.
 *  - costMicros populated from Twilio's price field (USD string × 1e6).
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { prisma } from '@bidstack/db';
import { decryptToken } from '@bidstack/shared/token-crypto';
import type pino from 'pino';
type SmsEntityType = 'CONTACT' | 'LEAD';
type ServiceLogger = Pick<pino.Logger, 'debug' | 'error' | 'info' | 'warn'>;

// ─── Constants ─────────────────────────────────────────────────────────────

const TWILIO_API_BASE = 'https://api.twilio.com/2010-04-01';

/** CTIA-mandated stop keywords — all must be honored (case-insensitive). */
const STOP_KEYWORDS = new Set(['stop', 'stopall', 'unsubscribe', 'end', 'quit', 'cancel']);

// ─── Types ─────────────────────────────────────────────────────────────────

export interface TwilioCredentials {
  accountSid: string;
  authToken: string;
}

export interface SendSmsParams {
  orgId: string;
  userId: string;
  toNumber: string;
  body: string;
  entityType?: SmsEntityType;
  entityId?: string;
}

export interface TwilioStatusCallbackPayload {
  MessageSid: string;
  MessageStatus: string;
  ErrorCode?: string;
  Price?: string;
  NumSegments?: string;
}

export interface TwilioInboundSmsPayload {
  MessageSid: string;
  From: string;
  To: string;
  Body: string;
  NumSegments?: string;
}

// ─── Credential helpers ────────────────────────────────────────────────────

/**
 * Load and decrypt Twilio credentials for the given org.
 * Returns the first active TWILIO integration token found.
 * WHY first: an org typically has one Twilio account; if multi-account is
 * needed a fromNumber parameter can disambiguate in a future iteration.
 */
async function loadCredentials(orgId: string): Promise<TwilioCredentials & { tokenId: string; fromNumber: string }> {
  const token = await prisma.integrationToken.findFirst({
    where: { orgId, provider: 'twilio', status: 'active' },
    select: { id: true, accessTokenEncrypted: true, externalAccountId: true },
  });

  if (!token) {
    throw new Error('No active Twilio integration found for this org. Connect Twilio first.');
  }

  const decrypted = decryptToken(token.accessTokenEncrypted);
  let creds: TwilioCredentials;
  try {
    creds = JSON.parse(decrypted) as TwilioCredentials;
  } catch {
    throw new Error('Twilio token payload is malformed. Reconnect the integration.');
  }

  if (!creds.accountSid || !creds.authToken) {
    throw new Error('Twilio token is missing accountSid or authToken. Reconnect the integration.');
  }

  // externalAccountId stores the Twilio phone number (E.164 format)
  const fromNumber = token.externalAccountId ?? '';
  if (!fromNumber) {
    throw new Error('No Twilio from-number configured on this token. Reconnect the integration.');
  }

  return { ...creds, tokenId: token.id, fromNumber };
}

// ─── Core send ─────────────────────────────────────────────────────────────

/**
 * Send an SMS via Twilio REST API.
 *
 * Steps:
 * 1. Load credentials for org
 * 2. Check SmsConsent — abort if opted out (TCPA mandatory)
 * 3. POST to Twilio Messages API
 * 4. Persist SmsMessage row (status=QUEUED)
 * 5. Log Activity on the linked entity
 */
export async function sendSms(params: SendSmsParams, log: ServiceLogger): Promise<{ messageId: string }> {
  const { orgId, userId, toNumber, body, entityType, entityId } = params;

  // Step 2: Consent check
  const consent = await prisma.smsConsent.findUnique({
    where: { orgId_phoneNumber: { orgId, phoneNumber: toNumber } },
    select: { optedOut: true },
  });

  if (consent?.optedOut) {
    throw new Error(`Cannot send SMS to ${toNumber}: number has opted out (TCPA).`);
  }

  // Step 1: Load credentials
  const { accountSid, authToken, tokenId, fromNumber } = await loadCredentials(orgId);

  // Step 3: POST to Twilio
  const formBody = new URLSearchParams({
    From: fromNumber,
    To: toNumber,
    Body: body,
    StatusCallback: `${process.env.PUBLIC_API_URL ?? ''}/api/v1/integrations/twilio/webhook/status`,
  });

  const basicAuth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
  const response = await fetch(
    `${TWILIO_API_BASE}/Accounts/${accountSid}/Messages.json`,
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basicAuth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formBody.toString(),
    },
  );

  if (!response.ok) {
    const err = await response.text();
    log.warn({ toNumber, status: response.status, err }, 'Twilio send failed');
    throw new Error(`Twilio API error ${response.status}: ${err}`);
  }

  const twilioMsg = (await response.json()) as { sid: string; num_segments: string };

  // Step 4: Persist SmsMessage
  const msg = await prisma.smsMessage.create({
    data: {
      orgId,
      userId,
      integrationTokenId: tokenId,
      fromNumber,
      toNumber,
      body,
      status: 'QUEUED',
      twilioSid: twilioMsg.sid,
      segments: parseInt(twilioMsg.num_segments ?? '1', 10),
      sentAt: new Date(),
      entityType: entityType ?? null,
      entityId: entityId ?? null,
    },
    select: { id: true },
  });

  // Step 5: Log Activity (best-effort; don't fail send on activity error)
  if (entityId && entityType) {
    await prisma.activity
      .create({
        data: {
          orgId,
          ownerId: userId,
          actorId: userId,
          type: 'custom',
          entityType: entityType.toLowerCase(),
          entityId,
          body: `SMS sent to ${toNumber}: "${body.slice(0, 80)}${body.length > 80 ? '…' : ''}"`,
        },
      })
      .catch((err: unknown) => log.warn({ err }, 'Failed to log SMS activity'));
  }

  log.info({ messageId: msg.id, twilioSid: twilioMsg.sid, toNumber }, 'SMS queued via Twilio');
  return { messageId: msg.id };
}

// ─── Status webhook ────────────────────────────────────────────────────────

/**
 * Handle Twilio status callback — updates SmsMessage.status.
 * Called after Twilio validates the X-Twilio-Signature (see route).
 */
export async function handleStatusCallback(
  payload: TwilioStatusCallbackPayload,
  log: ServiceLogger,
): Promise<void> {
  const { MessageSid, MessageStatus, ErrorCode, Price, NumSegments } = payload;

  const statusMap: Record<string, 'QUEUED' | 'SENT' | 'DELIVERED' | 'FAILED' | 'UNDELIVERED'> = {
    queued: 'QUEUED',
    sent: 'SENT',
    delivered: 'DELIVERED',
    failed: 'FAILED',
    undelivered: 'UNDELIVERED',
  };

  const mapped = statusMap[MessageStatus?.toLowerCase() ?? ''];
  if (!mapped) {
    log.debug({ MessageSid, MessageStatus }, 'Ignoring unknown Twilio status');
    return;
  }

  const costMicros = Price ? BigInt(Math.round(parseFloat(Price) * 1_000_000)) : undefined;

  await prisma.smsMessage.updateMany({
    where: { twilioSid: MessageSid },
    data: {
      status: mapped,
      errorCode: ErrorCode ? parseInt(ErrorCode, 10) : null,
      costMicros: costMicros ?? null,
      segments: NumSegments ? parseInt(NumSegments, 10) : undefined,
      deliveredAt: mapped === 'DELIVERED' ? new Date() : undefined,
    },
  });

  log.info({ MessageSid, status: mapped }, 'SmsMessage status updated');
}

// ─── Inbound SMS ───────────────────────────────────────────────────────────

/**
 * Handle inbound SMS from Twilio.
 *
 * If the body is a STOP keyword (case-insensitive):
 *  - Upsert SmsConsent with optedOut=true, source=STOP_KEYWORD
 *
 * Otherwise:
 *  - Persist the inbound SmsMessage (no userId — it's from the contact)
 *    linked to a Contact by phone number lookup, and log an Activity.
 */
export async function handleInboundSms(
  orgId: string,
  payload: TwilioInboundSmsPayload,
  log: ServiceLogger,
): Promise<void> {
  const { MessageSid, From, To, Body, NumSegments } = payload;
  const trimmedBody = Body.trim();
  const keyword = trimmedBody.split(/\s+/)[0]?.toLowerCase() ?? '';

  if (STOP_KEYWORDS.has(keyword)) {
    await prisma.smsConsent.upsert({
      where: { orgId_phoneNumber: { orgId, phoneNumber: From } },
      create: { orgId, phoneNumber: From, optedOut: true, optedOutAt: new Date(), source: 'STOP_KEYWORD' },
      update: { optedOut: true, optedOutAt: new Date(), source: 'STOP_KEYWORD' },
    });
    log.info({ From, keyword }, 'STOP keyword received — opt-out recorded');
    return;
  }

  // Try to match the sender to a Contact or Lead for activity logging
  const contact = await prisma.contact.findFirst({
    where: { orgId, phone: From },
    select: { id: true },
  });

  // Find the token that owns the To number for FK integrity
  const token = await prisma.integrationToken.findFirst({
    where: { orgId, provider: 'twilio', status: 'active' },
    select: { id: true },
  });

  if (token) {
    // Inbound messages don't have a userId — use org's first admin as fallback
    const adminUser = await prisma.user.findFirst({
      where: { orgId, role: 'admin' },
      select: { id: true },
    });

    if (adminUser) {
      await prisma.smsMessage.create({
        data: {
          orgId,
          userId: adminUser.id,
          integrationTokenId: token.id,
          fromNumber: From,
          toNumber: To,
          body: trimmedBody,
          status: 'DELIVERED',
          twilioSid: MessageSid,
          segments: NumSegments ? parseInt(NumSegments, 10) : 1,
          sentAt: new Date(),
          deliveredAt: new Date(),
          entityType: contact ? 'CONTACT' : null,
          entityId: contact?.id ?? null,
        },
      });

      if (contact) {
        await prisma.activity
          .create({
            data: {
              orgId,
              ownerId: adminUser.id,
              actorId: adminUser.id,
              type: 'custom',
              entityType: 'contact',
              entityId: contact.id,
              body: `Inbound SMS from ${From}: "${trimmedBody.slice(0, 80)}${trimmedBody.length > 80 ? '…' : ''}"`,
            },
          })
          .catch((err: unknown) => log.warn({ err }, 'Failed to log inbound SMS activity'));
      }
    }
  }

  log.info({ MessageSid, From }, 'Inbound SMS processed');
}

// ─── Signature validation ──────────────────────────────────────────────────

/**
 * Validate X-Twilio-Signature using HMAC-SHA1 with the authToken.
 *
 * WHY timingSafeEqual: prevents timing-oracle attacks on the HMAC comparison.
 * See: https://www.twilio.com/docs/usage/webhooks/webhooks-security
 */
export async function validateTwilioSignature(
  orgId: string,
  signature: string,
  url: string,
  params: Record<string, string>,
): Promise<boolean> {
  try {
    const { authToken } = await loadCredentials(orgId);

    // Build the string to sign: URL + sorted param key-value pairs
    const sortedParams = Object.keys(params)
      .sort()
      .reduce((acc, key) => acc + key + params[key], '');
    const toSign = url + sortedParams;

    const expected = createHmac('sha1', authToken).update(toSign).digest('base64');

    const expectedBuf = Buffer.from(expected, 'base64');
    const signatureBuf = Buffer.from(signature, 'base64');

    if (expectedBuf.length !== signatureBuf.length) return false;
    return timingSafeEqual(expectedBuf, signatureBuf);
  } catch {
    return false;
  }
}
