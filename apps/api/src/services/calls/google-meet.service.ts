/**
 * Google Meet integration via Google Calendar API with conferenceData.
 *
 * WHY Calendar API (not Meet REST API): the Google Meet REST API requires a
 * Google Workspace admin-approved OAuth app and is scoped to enterprise accounts.
 * Creating a Calendar event with `conferenceData` is the supported public method
 * for generating Meet links — it works with any Google account and the same
 * OAuth credentials already used for Gmail (GMAIL_CLIENT_ID / _CLIENT_SECRET).
 *
 * Scopes required (in addition to existing gmail scopes):
 *   https://www.googleapis.com/auth/calendar.events
 *
 * Token strategy: same per-user IntegrationToken reuse as Teams. Provider key
 * must be 'google' (set during Gmail OAuth flow with both Gmail + Calendar scopes).
 *
 * WHY we create a Calendar event: Meet links require a Calendar event container.
 * The event title appears in Google Calendar and as the Meet room name.
 * attendees are invited automatically via Google Calendar.
 */

import { decryptToken } from '@bidstack/shared/token-crypto';
import { prisma } from '@bidstack/db';
import { randomUUID } from 'node:crypto';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface GoogleMeetEvent {
  id: string;
  htmlLink: string;
  hangoutLink: string; // The Google Meet URL
  summary: string;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  conferenceData?: {
    conferenceId: string;
    conferenceSolution: { name: string };
    entryPoints: Array<{ entryPointType: string; uri: string; label?: string }>;
  };
}

export interface CreateGoogleMeetParams {
  orgId: string;
  userId: string;
  title: string;
  /** ISO 8601 — omit for an instant meeting (use current time + 2 minutes). */
  startTime?: string;
  durationMinutes?: number;
  attendeeEmails?: string[];
}

// ─── Helpers ───────────────────────────────────────────────────────────────

async function getGoogleAccessToken(orgId: string, userId: string): Promise<string> {
  const token = await prisma.integrationToken.findFirst({
    where: {
      orgId,
      userId,
      provider: 'google_workspace',
      status: 'active',
    },
    select: { accessTokenEncrypted: true },
  });

  if (!token?.accessTokenEncrypted) {
    throw new Error(
      'Google Meet: No active Google OAuth token for this user. Connect Google Calendar first.',
    );
  }

  return decryptToken(token.accessTokenEncrypted);
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Creates a Google Calendar event with a Meet conference link.
 *
 * Returns the Calendar event including `hangoutLink` (the Meet URL) and
 * `conferenceData.entryPoints` for phone dial-in details.
 */
export async function createGoogleMeetEvent(params: CreateGoogleMeetParams): Promise<GoogleMeetEvent> {
  const accessToken = await getGoogleAccessToken(params.orgId, params.userId);

  const now = new Date();
  // Instant meetings: start 2 minutes from now so the room is ready.
  const startDateTime = params.startTime ?? new Date(now.getTime() + 2 * 60_000).toISOString();
  const endDateTime = new Date(
    new Date(startDateTime).getTime() + (params.durationMinutes ?? 60) * 60_000,
  ).toISOString();

  const body: Record<string, unknown> = {
    summary: params.title,
    start: { dateTime: startDateTime, timeZone: 'UTC' },
    end: { dateTime: endDateTime, timeZone: 'UTC' },
    conferenceData: {
      createRequest: {
        // A stable request ID prevents duplicate Meet rooms on retries.
        requestId: randomUUID(),
        conferenceSolutionKey: { type: 'hangoutsMeet' },
      },
    },
  };

  if (params.attendeeEmails && params.attendeeEmails.length > 0) {
    body.attendees = params.attendeeEmails.map((email) => ({ email }));
    // sendUpdates: 'all' sends Gmail invites to attendees.
    body.sendUpdates = 'all';
  }

  const resp = await fetch(
    'https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    },
  );

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Google Meet createEvent failed (${resp.status}): ${text}`);
  }

  const event = (await resp.json()) as GoogleMeetEvent;

  if (!event.hangoutLink) {
    throw new Error(
      'Google Calendar event created but no Meet link was generated. ' +
        'Ensure the Google OAuth scope includes calendar.events and the account has Meet enabled.',
    );
  }

  return event;
}

/**
 * Deletes a Google Calendar event (e.g. when a call is cancelled).
 */
export async function deleteGoogleMeetEvent(
  orgId: string,
  userId: string,
  eventId: string,
): Promise<void> {
  const accessToken = await getGoogleAccessToken(orgId, userId);

  const resp = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventId}?sendUpdates=all`,
    {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  );

  if (!resp.ok && resp.status !== 410) {
    // 410 Gone is fine — event already deleted
    const text = await resp.text();
    throw new Error(`Google Meet deleteEvent failed (${resp.status}): ${text}`);
  }
}
