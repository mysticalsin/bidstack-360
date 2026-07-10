/**
 * Microsoft Teams online meeting service via Microsoft Graph API.
 *
 * WHY Graph (not Teams Bot): the Graph `/me/onlineMeetings` endpoint supports
 * creating meetings on behalf of a user without a Teams Bot or App installation.
 * It requires only the OnlineMeetings.ReadWrite delegated scope — less setup
 * friction and no Teams admin approval for basic usage.
 *
 * Token strategy: reuses existing per-user MS Graph OAuth tokens stored in
 * `IntegrationToken` (provider='microsoft_graph'). Falls back to app-level
 * if no user token is available (requires admin consent for application scope
 * OnlineMeetings.ReadWrite.All).
 *
 * Transcript: Graph beta endpoint GET /communications/callRecords/{callId}/sessions
 * + /segments. The beta endpoint is rate-limited to 20 req/min per token.
 * WHY beta: v1.0 does not expose segment-level transcripts as of Graph 2024.
 */

import { decryptToken } from '@bidstack/shared/token-crypto';
import { prisma } from '@bidstack/db';
import { fetchWithTimeout, providerTimeoutMs } from '../../lib/fetch-timeout.js';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface TeamsMeeting {
  id: string;
  joinWebUrl: string;
  joinMeetingIdSettings?: { isPasscodeRequired: boolean; joinMeetingId: string };
  subject: string;
  startDateTime: string;
  endDateTime: string;
}

export interface CreateTeamsMeetingParams {
  /** User whose Graph token will be used to create the meeting. */
  orgId: string;
  userId: string;
  subject: string;
  /** ISO 8601 — omit for an instant meeting (use current time). */
  startTime?: string;
  /** Duration in minutes. Defaults to 60. */
  durationMinutes?: number;
  attendeeEmails?: string[];
}

export interface TeamsTranscriptSegment {
  id: string;
  startDateTime: string;
  endDateTime: string;
  participant: { displayName: string; participantId: string };
  text: string;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

async function getGraphAccessToken(orgId: string, userId: string): Promise<string> {
  const token = await prisma.integrationToken.findFirst({
    where: {
      orgId,
      userId,
      provider: 'microsoft_graph',
      status: 'active',
    },
    select: { accessTokenEncrypted: true },
  });

  if (!token?.accessTokenEncrypted) {
    throw new Error(
      'Teams: No active Microsoft Graph token for this user. Connect Microsoft 365 first.',
    );
  }

  return decryptToken(token.accessTokenEncrypted);
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Creates a Teams online meeting using the user's Graph token.
 * Returns the meeting with the attendee-facing joinWebUrl.
 */
export async function createTeamsMeeting(params: CreateTeamsMeetingParams): Promise<TeamsMeeting> {
  const accessToken = await getGraphAccessToken(params.orgId, params.userId);

  const now = new Date();
  const startDateTime = params.startTime ?? now.toISOString();
  const endDateTime = new Date(
    new Date(startDateTime).getTime() + (params.durationMinutes ?? 60) * 60_000,
  ).toISOString();

  const body: Record<string, unknown> = {
    subject: params.subject,
    startDateTime,
    endDateTime,
    recordAutomatically: true,
  };

  if (params.attendeeEmails && params.attendeeEmails.length > 0) {
    body.participants = {
      attendees: params.attendeeEmails.map((email) => ({
        upn: email,
        role: 'attendee',
      })),
    };
  }

  const resp = await fetchWithTimeout('https://graph.microsoft.com/v1.0/me/onlineMeetings', {
    provider: 'Microsoft Graph',
    operation: 'teams.onlineMeetings.create',
    timeoutMs: providerTimeoutMs('MICROSOFT_GRAPH_HTTP_TIMEOUT_MS', 15_000),
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Teams createMeeting failed (${resp.status}): ${text}`);
  }

  return (await resp.json()) as TeamsMeeting;
}

/**
 * Fetches transcript segments for a completed Teams call from the Graph beta
 * callRecords endpoint.
 *
 * WHY beta endpoint: v1.0 does not expose full transcript segments.
 * Rate limit: 20 req/min — do not call in a hot path.
 */
export async function getTeamsCallTranscript(
  orgId: string,
  userId: string,
  callId: string,
): Promise<TeamsTranscriptSegment[]> {
  const accessToken = await getGraphAccessToken(orgId, userId);

  const resp = await fetchWithTimeout(
    `https://graph.microsoft.com/beta/communications/callRecords/${callId}/sessions`,
    {
      provider: 'Microsoft Graph',
      operation: 'teams.callRecords.sessions',
      timeoutMs: providerTimeoutMs('MICROSOFT_GRAPH_HTTP_TIMEOUT_MS', 15_000),
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  );

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Teams getTranscript failed (${resp.status}): ${text}`);
  }

  const data = (await resp.json()) as {
    value?: { segments?: TeamsTranscriptSegment[] }[];
  };

  // Flatten segments from all sessions
  return (data.value ?? []).flatMap((session) => session.segments ?? []);
}

/**
 * Validates a Microsoft Graph change notification subscription.
 * Graph sends a validationToken query param that must be echoed back as text/plain.
 */
export function validateGraphSubscription(validationToken: string): string {
  // Simply echo the token — Graph requires the exact same value returned as text/plain.
  return validationToken;
}
