/**
 * Notification delivery (slice 21): instant email and Teams copies of Polo
 * alerts, plus the daily account digest. Recipients are Polo users and the
 * content is Polo data; this path never writes to customer contacts.
 *
 * Email goes through the platform sender (Resend) when RESEND_API_KEY and
 * NOTIFICATION_FROM_EMAIL are set; otherwise it logs and skips. Teams posts an
 * Adaptive Card to the webhook the user saved (encrypted at rest).
 */
import {
  ACCOUNT_ALERT_COALESCE_MS,
  ACCOUNT_ALERT_EXTERNAL_HOURLY_LIMIT,
  absoluteAppUrl,
  buildTeamsAdaptiveCard,
  postTeamsCard,
  type NotificationDeliveryJob,
} from '@bidstack/shared';

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

export interface DeliveryLog {
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
}

export interface DeliveryStore {
  findUser(orgId: string, userId: string): Promise<{ email: string | null; name: string | null } | null>;
  findTeamsWebhookEnc(orgId: string, userId: string): Promise<string | null>;
  markSent(input: { orgId: string; notificationId: string; channel: 'email' | 'teams'; at: Date }): Promise<void>;
  digestRecipients(limit: number): Promise<Array<{ orgId: string; userId: string }>>;
  digestItems(orgId: string, userId: string, since: Date): Promise<Array<{ title: string; body: string | null; url: string | null }>>;
}

export interface DeliveryLimiter {
  /** Set the key to owner only if absent; true when set now or already held by the same owner (a retry). */
  claim(key: string, ttlSeconds: number, owner: string): Promise<boolean>;
  /** Increment a counter that expires after ttlSeconds; returns the new value. */
  incr(key: string, ttlSeconds: number): Promise<number>;
}

export interface DeliveryDeps {
  store: DeliveryStore;
  limiter: DeliveryLimiter;
  decrypt: (blob: string) => string;
  fetchImpl: typeof fetch;
  env: NodeJS.ProcessEnv;
  log: DeliveryLog;
  now: () => Date;
}

export type DeliveryOutcome =
  | 'sent'
  | 'not_configured'
  | 'coalesced'
  | 'rate_limited'
  | 'no_recipient'
  | 'no_webhook'
  | 'provider_rejected';

/** Retryable failure (network or 5xx); BullMQ backs off and retries. */
export class DeliveryRetryError extends Error {}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export async function sendPlatformEmail(
  deps: Pick<DeliveryDeps, 'env' | 'fetchImpl'>,
  msg: { to: string; subject: string; html: string; text: string },
): Promise<{ ok: true } | { ok: false; reason: 'not_configured' | 'rejected' | 'retry'; status?: number }> {
  const apiKey = deps.env.RESEND_API_KEY;
  const from = deps.env.NOTIFICATION_FROM_EMAIL;
  if (!apiKey || !from) return { ok: false, reason: 'not_configured' };
  let res: Response;
  try {
    res = await deps.fetchImpl(RESEND_ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [msg.to], subject: msg.subject, html: msg.html, text: msg.text }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return { ok: false, reason: 'retry' };
  }
  if (res.ok) return { ok: true };
  return { ok: false, reason: res.status >= 500 || res.status === 429 ? 'retry' : 'rejected', status: res.status };
}

function alertEmail(title: string, body: string | null, link: string | null) {
  const html = [
    `<p style="font:600 16px system-ui,sans-serif;margin:0 0 8px">${escapeHtml(title)}</p>`,
    body ? `<p style="font:14px system-ui,sans-serif;color:#444;margin:0 0 16px">${escapeHtml(body)}</p>` : '',
    link ? `<p><a href="${escapeHtml(link)}" style="font:600 14px system-ui,sans-serif">Open in Polo</a></p>` : '',
    '<p style="font:12px system-ui,sans-serif;color:#888">You get this because you follow this account in Polo. Change it in Settings, Notifications.</p>',
  ].join('');
  const text = [title, body ?? '', link ? `Open in Polo: ${link}` : ''].filter(Boolean).join('\n\n');
  return { html, text };
}

function hourBucket(now: Date): string {
  return now.toISOString().slice(0, 13);
}

export async function deliverOne(
  job: Extract<NotificationDeliveryJob, { kind: 'deliver' }>,
  deps: DeliveryDeps,
  jobId: string,
): Promise<DeliveryOutcome> {
  const now = deps.now();
  const user = await deps.store.findUser(job.orgId, job.userId);
  if (!user) return 'no_recipient';

  if (job.companyId) {
    const fresh = await deps.limiter.claim(
      `notif:co:${job.channel}:${job.userId}:${job.companyId}`,
      Math.ceil(ACCOUNT_ALERT_COALESCE_MS / 1000),
      jobId,
    );
    if (!fresh) return 'coalesced';
  }
  const sentThisHour = await deps.limiter.incr(`notif:rl:${job.channel}:${job.userId}:${hourBucket(now)}`, 3600);
  if (sentThisHour > ACCOUNT_ALERT_EXTERNAL_HOURLY_LIMIT) {
    deps.log.info({ userId: job.userId, channel: job.channel }, 'notification delivery rate limit reached');
    return 'rate_limited';
  }

  const baseUrl = deps.env.PUBLIC_BASE_URL ?? 'http://localhost:5173';
  const link = absoluteAppUrl(baseUrl, job.url);

  if (job.channel === 'email') {
    if (!user.email) return 'no_recipient';
    const { html, text } = alertEmail(job.title, job.body, link);
    const res = await sendPlatformEmail(deps, { to: user.email, subject: job.title, html, text });
    if (!res.ok) {
      if (res.reason === 'not_configured') {
        deps.log.info({ userId: job.userId }, 'email alert skipped: no platform sender configured');
        return 'not_configured';
      }
      if (res.reason === 'retry') throw new DeliveryRetryError('email provider unavailable');
      deps.log.warn({ userId: job.userId, status: res.status }, 'email alert rejected by provider');
      return 'provider_rejected';
    }
  } else {
    const enc = await deps.store.findTeamsWebhookEnc(job.orgId, job.userId);
    if (!enc) return 'no_webhook';
    let url: string;
    try {
      url = deps.decrypt(enc);
    } catch {
      deps.log.warn({ userId: job.userId }, 'teams webhook could not be decrypted');
      return 'no_webhook';
    }
    const res = await postTeamsCard(url, buildTeamsAdaptiveCard({ title: job.title, body: job.body, url: link }), deps.fetchImpl);
    if (!res.ok) {
      if (res.reason === 'network_error' || (res.status !== null && (res.status >= 500 || res.status === 429))) {
        throw new DeliveryRetryError('teams webhook unavailable');
      }
      deps.log.warn({ userId: job.userId, status: res.status }, 'teams alert rejected');
      return 'provider_rejected';
    }
  }

  if (job.notificationId) {
    await deps.store.markSent({ orgId: job.orgId, notificationId: job.notificationId, channel: job.channel, at: now });
  }
  return 'sent';
}

/** One email per opted-in user summarising the last day of account alerts. */
export async function sendDailyDigest(deps: DeliveryDeps): Promise<{ sent: number; skipped: number }> {
  const now = deps.now();
  const since = new Date(now.getTime() - 24 * 60 * 60_000);
  const baseUrl = deps.env.PUBLIC_BASE_URL ?? 'http://localhost:5173';
  let sent = 0;
  let skipped = 0;
  if (!deps.env.RESEND_API_KEY || !deps.env.NOTIFICATION_FROM_EMAIL) {
    deps.log.info({}, 'account digest skipped: no platform sender configured');
    return { sent, skipped };
  }
  for (const r of await deps.store.digestRecipients(2000)) {
    const items = await deps.store.digestItems(r.orgId, r.userId, since);
    const user = items.length ? await deps.store.findUser(r.orgId, r.userId) : null;
    if (!user?.email) {
      skipped++;
      continue;
    }
    const subject = `Polo: ${items.length} account update${items.length === 1 ? '' : 's'} in the last day`;
    const list = items
      .map((i) => {
        const link = absoluteAppUrl(baseUrl, i.url);
        const label = escapeHtml(i.title);
        return `<li style="margin:0 0 6px">${link ? `<a href="${escapeHtml(link)}">${label}</a>` : label}${i.body ? `<br><span style="color:#666">${escapeHtml(i.body)}</span>` : ''}</li>`;
      })
      .join('');
    const html = `<p style="font:600 16px system-ui,sans-serif">${escapeHtml(subject)}</p><ul style="font:14px system-ui,sans-serif;padding-left:18px">${list}</ul><p style="font:12px system-ui,sans-serif;color:#888">Turn the digest off in Settings, Notifications.</p>`;
    const text = [subject, ...items.map((i) => `- ${i.title}${i.body ? ` (${i.body})` : ''}`)].join('\n');
    const res = await sendPlatformEmail(deps, { to: user.email, subject, html, text });
    if (res.ok) sent++;
    else skipped++;
  }
  return { sent, skipped };
}
