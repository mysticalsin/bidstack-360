/**
 * Teams chat import (slice 26). A person picks chats or channel threads they
 * are in and files chosen messages to an account. Read-only: Polo reads
 * through Microsoft Graph with Chat.Read (and ChannelMessage.Read.All where
 * an admin approved it) and never posts to Teams.
 */
import { z } from 'zod';

const Iso = z.string().datetime();

/** Can the caller import from Teams right now, and if not, what fixes it. */
export const TeamsAccess = z.object({
  /** not_connected: no Microsoft 365 grant. needs_consent: grant lacks Chat.Read. */
  state: z.enum(['ready', 'not_connected', 'needs_consent', 'revoked', 'not_configured']),
  /** Channel threads: admin approval is a server setting plus the grant. */
  channels: z.enum(['ready', 'needs_consent', 'needs_admin_consent']),
  accountEmail: z.string().nullable(),
});
export type TeamsAccess = z.infer<typeof TeamsAccess>;

/** One conversation a message list can be read from. */
export const TeamsThreadRef = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('chat'), chatId: z.string().min(1).max(300) }),
  z.object({
    kind: z.literal('channel_thread'),
    teamId: z.string().min(1).max(300),
    channelId: z.string().min(1).max(300),
    messageId: z.string().min(1).max(300),
  }),
]);
export type TeamsThreadRef = z.infer<typeof TeamsThreadRef>;

export const TeamsChatSummary = z.object({
  ref: TeamsThreadRef,
  /** Topic, else member names, else "Teams chat". */
  title: z.string(),
  /** chat: oneOnOne, group, meeting. channel_thread: team and channel names. */
  subtitle: z.string().nullable(),
  memberCount: z.number().int().min(0),
  lastActivityAt: Iso.nullable(),
  webUrl: z.string().url().nullable(),
  /** The chat is linked for ongoing sync. */
  syncLinkId: z.string().uuid().nullable(),
});
export type TeamsChatSummary = z.infer<typeof TeamsChatSummary>;

export const TeamsChatList = z.object({
  items: z.array(TeamsChatSummary),
});
export type TeamsChatList = z.infer<typeof TeamsChatList>;

export const TeamsMessagePreview = z.object({
  /** Graph chatMessage id. */
  id: z.string(),
  authorName: z.string().nullable(),
  createdAt: Iso,
  /** Plain text, trimmed; no HTML. */
  preview: z.string(),
  attachmentNames: z.array(z.string()),
  webUrl: z.string().url().nullable(),
  /** Already filed to an account in this org. */
  filed: z.boolean(),
});
export type TeamsMessagePreview = z.infer<typeof TeamsMessagePreview>;

export const TeamsAccountSuggestion = z.object({
  companyId: z.string().uuid(),
  name: z.string(),
  reason: z.enum(['contact', 'domain']),
  /** The contact email or the domain that matched. */
  match: z.string(),
});
export type TeamsAccountSuggestion = z.infer<typeof TeamsAccountSuggestion>;

export const TeamsThreadMessages = z.object({
  title: z.string(),
  participantCount: z.number().int().min(0),
  items: z.array(TeamsMessagePreview),
  suggestions: z.array(TeamsAccountSuggestion),
});
export type TeamsThreadMessages = z.infer<typeof TeamsThreadMessages>;

export const TEAMS_IMPORT_MAX_MESSAGES = 200;

export const TeamsImportRequest = z.object({
  ref: TeamsThreadRef,
  companyId: z.string().uuid(),
  opportunityId: z.string().uuid().nullable().optional(),
  /** Empty with keepSyncing only links the chat. */
  messageIds: z.array(z.string().min(1).max(300)).max(TEAMS_IMPORT_MAX_MESSAGES),
  keepSyncing: z.boolean().default(false),
});
export type TeamsImportRequest = z.infer<typeof TeamsImportRequest>;

export const TeamsImportResult = z.object({
  created: z.number().int().min(0),
  updated: z.number().int().min(0),
  skipped: z.number().int().min(0),
  /** Already filed to another account by someone in the org. */
  alreadyFiled: z.number().int().min(0),
  syncLinkId: z.string().uuid().nullable(),
});
export type TeamsImportResult = z.infer<typeof TeamsImportResult>;

export const TeamsSyncLink = z.object({
  id: z.string().uuid(),
  ref: TeamsThreadRef,
  title: z.string(),
  companyId: z.string().uuid(),
  companyName: z.string(),
  keepSyncing: z.boolean(),
  lastSyncedAt: Iso.nullable(),
  /** consent_required when Graph refused the read; shown as a reconnect prompt. */
  lastError: z.string().nullable(),
});
export type TeamsSyncLink = z.infer<typeof TeamsSyncLink>;

export const TeamsSyncLinks = z.object({ items: z.array(TeamsSyncLink) });
export type TeamsSyncLinks = z.infer<typeof TeamsSyncLinks>;

/** Error code a route returns when Graph refuses for missing consent. */
export const TEAMS_CONSENT_REQUIRED = 'teams_consent_required';
