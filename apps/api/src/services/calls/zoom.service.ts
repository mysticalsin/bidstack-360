/**
 * Zoom Server-to-Server OAuth integration for meeting creation.
 *
 * WHY Server-to-Server OAuth (not per-user OAuth): Zoom S2S tokens represent
 * the org's account rather than an individual user, which means meetings can
 * be created even if the rep has not individually authorized Zoom. The host
 * email (joinUrl, hostJoinUrl) identifies the meeting host inside Zoom.
 *
 * WHY we cache the S2S access token in-process: tokens last 1 h; fetching a
 * new one on every API call would add latency. A simple in-memory cache with
 * a 55-minute TTL is sufficient for a single API process; multi-instance
 * deployments should switch to Redis caching.
 *
 * Token storage: ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET via env.
 * These are org-wide credentials, not per-user OAuth tokens.
 *
 * Webhook validation: Zoom sends X-Zoom-Signature-V2 (HMAC-SHA256 of the raw
 * body with timestamp prefix). We validate using ZOOM_SECRET_TOKEN.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface ZoomMeeting {
  id: string;
  join_url: string;
  start_url: string;
  topic: string;
  start_time: string;
  duration: number;
  password?: string;
  uuid?: string;
}

export interface CreateZoomMeetingParams {
  topic: string;
  /** ISO 8601 start time — omit for an instant meeting (starts immediately). */
  startTime?: string;
  /** Duration in minutes. Defaults to 60. */
  durationMinutes?: number;
  /** Comma-separated attendee emails for Zoom's invite list (informational). */
  attendeeEmails?: string[];
}

export interface ZoomRecordingFile {
  id: string;
  file_type: string;
  download_url: string;
  status: string;
  recording_type: string;
}

// ─── Token cache (in-process) ──────────────────────────────────────────────

interface TokenCache {
  accessToken: string;
  expiresAt: number; // ms epoch
}

let _tokenCache: TokenCache | null = null;

// ─── Helpers ───────────────────────────────────────────────────────────────

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Zoom: ${name} env var is required`);
  return val;
}

async function fetchAccessToken(): Promise<string> {
  const now = Date.now();
  if (_tokenCache && _tokenCache.expiresAt > now + 60_000) {
    return _tokenCache.accessToken;
  }

  const accountId = requireEnv('ZOOM_ACCOUNT_ID');
  const clientId = requireEnv('ZOOM_CLIENT_ID');
  const clientSecret = requireEnv('ZOOM_CLIENT_SECRET');

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const resp = await fetch(
    `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${encodeURIComponent(accountId)}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    },
  );

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Zoom token fetch failed (${resp.status}): ${text}`);
  }

  const data = (await resp.json()) as { access_token: string; expires_in: number };
  _tokenCache = {
    accessToken: data.access_token,
    // Cache for 55 min (token lasts 1 h; 5 min buffer)
    expiresAt: now + (data.expires_in - 300) * 1_000,
  };
  return _tokenCache.accessToken;
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Creates an instant or scheduled Zoom meeting.
 *
 * @returns ZoomMeeting containing joinUrl (attendees) and start_url (host).
 */
export async function createZoomMeeting(params: CreateZoomMeetingParams): Promise<ZoomMeeting> {
  const token = await fetchAccessToken();

  const body: Record<string, unknown> = {
    topic: params.topic,
    type: params.startTime ? 2 : 1, // 1=instant, 2=scheduled
    duration: params.durationMinutes ?? 60,
    settings: {
      auto_recording: 'cloud',
      waiting_room: false,
      join_before_host: true,
      mute_upon_entry: false,
    },
  };

  if (params.startTime) {
    body.start_time = params.startTime;
  }

  const resp = await fetch('https://api.zoom.us/v2/users/me/meetings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Zoom createMeeting failed (${resp.status}): ${text}`);
  }

  return (await resp.json()) as ZoomMeeting;
}

/**
 * Retrieves cloud recording files for a given meeting UUID.
 * Call this from the recording.completed webhook handler.
 */
export async function getZoomRecordings(meetingUuid: string): Promise<ZoomRecordingFile[]> {
  const token = await fetchAccessToken();
  // Double-encode UUID — Zoom requires it for UUIDs containing `/` or `//`
  const encoded = encodeURIComponent(encodeURIComponent(meetingUuid));

  const resp = await fetch(`https://api.zoom.us/v2/meetings/${encoded}/recordings`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Zoom getRecordings failed (${resp.status}): ${text}`);
  }

  const data = (await resp.json()) as { recording_files?: ZoomRecordingFile[] };
  return data.recording_files ?? [];
}

/**
 * Validates a Zoom webhook request using HMAC-SHA256 (v2 signature).
 *
 * Zoom sends:
 *   x-zm-request-timestamp: <epoch_ms>
 *   x-zm-signature: v0=<hex_hmac>
 *
 * The message to sign is: "v0:<timestamp>:<rawBody>"
 */
export function validateZoomWebhook(
  signature: string,
  timestamp: string,
  rawBody: string,
): boolean {
  const secret = process.env.ZOOM_SECRET_TOKEN ?? '';
  if (!secret) return false;

  // Reject requests older than 5 minutes
  if (Math.abs(Date.now() - Number(timestamp)) > 300_000) return false;

  const message = `v0:${timestamp}:${rawBody}`;
  const expected = `v0=${createHmac('sha256', secret).update(message).digest('hex')}`;

  try {
    return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

/**
 * Returns the URL validation response required during Zoom webhook registration.
 * When Zoom sends event_type="endpoint.url_validation", reply with this.
 */
export function zoomUrlValidationResponse(plainToken: string): Record<string, string> {
  const secret = process.env.ZOOM_SECRET_TOKEN ?? '';
  // Prevent this endpoint from being abused as an HMAC signing oracle. It returns
  // HMAC(secret, plainToken); the webhook signature is HMAC(secret, `v0:<ts>:<body>`)
  // under the SAME key with no domain separation — so an attacker who controls
  // plainToken could obtain a valid signature for a forged webhook body. A genuine
  // Zoom url_validation token is an opaque value with no ':'; reject anything that
  // could form the `v0:<ts>:<body>` message so the oracle cannot be exploited.
  if (!plainToken || plainToken.includes(':')) {
    const err = new Error('Invalid Zoom url_validation plainToken') as Error & { statusCode?: number };
    err.statusCode = 400;
    throw err;
  }
  const encryptedToken = createHmac('sha256', secret).update(plainToken).digest('hex');
  return { plainToken, encryptedToken };
}
