/**
 * System transactional mail: booking confirmations and NPS survey links.
 *
 * Goes out through the platform sender (Resend), never through a user's
 * connected mailbox. Mailboxes are connected read-only and user-authored mail
 * stays a draft the human sends; this path is only for mail the recipient
 * triggered or expects from the system.
 *
 * A mail that cannot go out is never dropped silently: the failure is logged
 * at error level and the responsible user gets an in-app notification.
 *
 * Env (names only): RESEND_API_KEY, NOTIFICATION_FROM_EMAIL.
 */

import { prisma } from '@bidstack/db';

import { reserveOutboundCommunication } from '../lib/outbound-communication-guard.js';
import type { EmailAddress, ServiceLogger } from './email-integration.helpers.js';
import { createNotification } from './notification.service.js';

const RESEND_ENDPOINT = 'https://api.resend.com/emails';
const SEND_TIMEOUT_MS = 10_000;
const SYSTEM_SENDER_KEY = 'system';

export interface TransactionalEmailParams {
  orgId: string;
  /** User told in-app when the mail cannot go out; null logs only. */
  notifyUserId: string | null;
  to: EmailAddress[];
  subject: string;
  html: string;
  text: string;
  entityType: string;
  entityId: string;
  /** Notification title shown when the mail cannot go out. */
  failureTitle: string;
}

export type TransactionalEmailFailure = 'not_configured' | 'rate_limited' | 'provider_error';

export type TransactionalEmailResult =
  | { sent: true; providerMessageId: string }
  | { sent: false; reason: TransactionalEmailFailure };

const FAILURE_BODY: Record<TransactionalEmailFailure, string> = {
  not_configured: 'No transactional email sender is configured for this workspace.',
  rate_limited: 'The daily email limit for this workspace was reached.',
  provider_error: 'The email provider rejected the message.',
};

function formatAddress(a: EmailAddress): string {
  return a.name ? `${a.name} <${a.email}>` : a.email;
}

async function surfaceFailure(
  params: TransactionalEmailParams,
  reason: TransactionalEmailFailure,
  log: ServiceLogger,
  err?: unknown,
): Promise<TransactionalEmailResult> {
  log.error(
    { err, reason, orgId: params.orgId, entityType: params.entityType, entityId: params.entityId },
    'transactional email not sent',
  );
  if (params.notifyUserId) {
    await createNotification({
      orgId: params.orgId,
      userId: params.notifyUserId,
      type: 'system',
      title: params.failureTitle,
      body: FAILURE_BODY[reason],
      entityType: params.entityType,
      entityId: params.entityId,
    }).catch((notifyErr) =>
      log.error({ err: notifyErr, orgId: params.orgId }, 'transactional email failure notice failed'),
    );
  }
  return { sent: false, reason };
}

export async function sendTransactionalEmail(
  params: TransactionalEmailParams,
  log: ServiceLogger,
): Promise<TransactionalEmailResult> {
  const apiKey = process.env['RESEND_API_KEY'];
  const from = process.env['NOTIFICATION_FROM_EMAIL'];
  if (!apiKey || !from) return surfaceFailure(params, 'not_configured', log);

  let reservation: Awaited<ReturnType<typeof reserveOutboundCommunication>>;
  try {
    reservation = await reserveOutboundCommunication(
      {
        channel: 'email',
        orgId: params.orgId,
        userId: params.notifyUserId ?? SYSTEM_SENDER_KEY,
        units: params.to.length,
      },
      log,
    );
  } catch (err) {
    return surfaceFailure(params, 'rate_limited', log, err);
  }

  const settings = await prisma.orgSettings.findUnique({
    where: { orgId: params.orgId },
    select: { emailFromAddress: true },
  });

  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from,
        to: params.to.map(formatAddress),
        ...(settings?.emailFromAddress ? { reply_to: settings.emailFromAddress } : {}),
        subject: params.subject,
        html: params.html,
        text: params.text,
      }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
    if (!res.ok) {
      throw new Error(`Resend responded ${res.status}`);
    }
    const { id } = (await res.json()) as { id?: string };
    log.info(
      { orgId: params.orgId, entityType: params.entityType, entityId: params.entityId },
      'transactional email sent',
    );
    return { sent: true, providerMessageId: id ?? '' };
  } catch (err) {
    await reservation.rollback();
    return surfaceFailure(params, 'provider_error', log, err);
  }
}
