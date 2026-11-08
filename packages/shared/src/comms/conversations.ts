/**
 * Synced meetings and emails on the account page. The worker turns a filed
 * CalendarEvent or EmailMessage into an Activity; this is the read shape of
 * those activities plus the participant rules both sides share.
 */
import { z } from 'zod';

/** Consumer mail domains: never an account domain, never "internal". */
export const FREE_MAIL_DOMAINS: ReadonlySet<string> = new Set([
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'msn.com',
  'yahoo.com',
  'icloud.com',
  'me.com',
  'aol.com',
  'proton.me',
  'protonmail.com',
  'gmx.com',
]);

/** Where a synced item came from, as shown on its chip. */
export const CommsSource = z.enum(['outlook', 'teams', 'gmail', 'google_calendar']);
export type CommsSource = z.infer<typeof CommsSource>;

export const COMMS_SOURCE_LABEL: Record<CommsSource, string> = {
  outlook: 'Outlook',
  teams: 'Teams',
  gmail: 'Gmail',
  google_calendar: 'Google Calendar',
};

export const MeetingChannel = z.enum(['teams', 'google_meet', 'in_person_or_other']);
export type MeetingChannel = z.infer<typeof MeetingChannel>;

/** Chip source for a synced item. A Teams join link wins over the calendar. */
export function commsSourceFor(
  provider: 'microsoft_graph' | 'google_workspace' | 'OUTLOOK' | 'GMAIL',
  channel: MeetingChannel | null,
): CommsSource {
  if (channel === 'teams') return 'teams';
  if (provider === 'microsoft_graph' || provider === 'OUTLOOK') return 'outlook';
  if (provider === 'GMAIL') return 'gmail';
  return 'google_calendar';
}

export const ACCOUNT_CONVERSATIONS_PAGE = 25;

const Iso = z.string().datetime();

export const AccountConversation = z.object({
  /** Activity id. */
  id: z.string().uuid(),
  type: z.enum(['meeting', 'email', 'teams_message']),
  subject: z.string(),
  occurredAt: Iso,
  endAt: Iso.nullable(),
  status: z.enum(['planned', 'completed', 'cancelled']),
  direction: z.enum(['inbound', 'outbound']).nullable(),
  participantCount: z.number().int().min(0),
  /** Null when the row was logged in Polo or pushed by the ingest API. */
  source: CommsSource.nullable(),
  /** Chip text: "Outlook", "Teams", "Gmail", "Logged in Polo", or the ingest source. */
  sourceLabel: z.string(),
  channel: MeetingChannel.nullable(),
  /** automatic = matched by attendee or domain; manual = a person filed it. */
  filing: z.enum(['automatic', 'manual']).nullable(),
  /** Several open opportunities and none picked: filed to the account only. */
  needsOpportunity: z.boolean(),
  opportunity: z.object({ id: z.string().uuid(), name: z.string() }).nullable(),
  /** The synced record behind the row, for the re-file action. */
  sourceRecord: z
    .object({ kind: z.enum(['calendar_event', 'email_message']), id: z.string().uuid() })
    .nullable(),
  /** The caller owns the meeting and the calendar re-file route accepts it. */
  canRefile: z.boolean(),
  /** Deep link back to the source (Teams message webUrl). */
  webUrl: z.string().url().nullable().optional(),
  /** Display name of who wrote it (Teams messages). */
  author: z.string().nullable().optional(),
});
export type AccountConversation = z.infer<typeof AccountConversation>;

export const AccountConversations = z.object({
  companyId: z.string().uuid(),
  items: z.array(AccountConversation),
  nextCursor: z.string().nullable(),
  /** Re-file targets: open opportunities on this account. */
  openOpportunities: z.array(z.object({ id: z.string().uuid(), name: z.string() })),
});
export type AccountConversations = z.infer<typeof AccountConversations>;
