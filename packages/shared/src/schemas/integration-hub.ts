/**
 * Shared Zod schemas for Wave 4 Integration Hub:
 *  - Gmail / Outlook email send + log
 *  - Slack notifications
 *  - Zapier REST-hook trigger + action surface
 *
 * WHY here: API routes + worker queues + frontend types all share these
 * shapes. Colocating in shared avoids duplication and type drift.
 */

import { z } from 'zod';

// ─── Email ────────────────────────────────────────────────────────────────

export const EmailRecipient = z.object({
  email: z.string().email(),
  name: z.string().optional(),
});
export type EmailRecipient = z.infer<typeof EmailRecipient>;

export const SendEmailRequest = z.object({
  to: z.array(EmailRecipient).min(1).max(50),
  cc: z.array(EmailRecipient).max(20).optional().default([]),
  bcc: z.array(EmailRecipient).max(20).optional().default([]),
  subject: z.string().min(1).max(998),
  /** Plain-text fallback body */
  text: z.string().optional(),
  /** HTML body — tracking pixel injected server-side */
  html: z.string().optional(),
  /** Polymorphic CRM entity this email is linked to */
  entityType: z.enum(['deal', 'contact', 'lead']).optional(),
  entityId: z.string().uuid().optional(),
}).refine(
  (v) => v.text != null || v.html != null,
  { message: 'At least one of text or html is required' },
);
export type SendEmailRequest = z.infer<typeof SendEmailRequest>;

export const EmailMessageDto = z.object({
  id: z.string().uuid(),
  orgId: z.string().uuid(),
  userId: z.string().uuid(),
  provider: z.enum(['GMAIL', 'OUTLOOK']),
  externalMessageId: z.string(),
  threadId: z.string().nullable(),
  fromEmail: z.string().email(),
  toEmails: z.array(EmailRecipient),
  ccEmails: z.array(EmailRecipient),
  subject: z.string(),
  bodyText: z.string().nullable(),
  isOutbound: z.boolean(),
  sentAt: z.string().datetime().nullable(),
  receivedAt: z.string().datetime().nullable(),
  openedAt: z.string().datetime().nullable(),
  clickedAt: z.string().datetime().nullable(),
  entityType: z.string().nullable(),
  entityId: z.string().uuid().nullable(),
  createdAt: z.string().datetime(),
});
export type EmailMessageDto = z.infer<typeof EmailMessageDto>;

export const EmailListResponse = z.object({
  messages: z.array(EmailMessageDto),
  total: z.number().int(),
  hasMore: z.boolean(),
});
export type EmailListResponse = z.infer<typeof EmailListResponse>;

// ─── Integration status (used on IntegrationsPage) ────────────────────────

export const IntegrationStatus = z.enum(['CONNECTED', 'DISCONNECTED', 'ERROR']);
export type IntegrationStatus = z.infer<typeof IntegrationStatus>;

export const IntegrationStatusDto = z.object({
  provider: z.string(),
  status: IntegrationStatus,
  connectedEmail: z.string().nullable(),
  lastSyncedAt: z.string().datetime().nullable(),
  errorMessage: z.string().nullable(),
  scopes: z.array(z.string()),
});
export type IntegrationStatusDto = z.infer<typeof IntegrationStatusDto>;

export const IntegrationListResponse = z.object({
  integrations: z.array(IntegrationStatusDto),
});
export type IntegrationListResponse = z.infer<typeof IntegrationListResponse>;

// ─── Slack ────────────────────────────────────────────────────────────────

export const SlackChannelDto = z.object({
  id: z.string().uuid(),
  channelId: z.string(),
  channelName: z.string(),
  isShared: z.boolean(),
});
export type SlackChannelDto = z.infer<typeof SlackChannelDto>;

export const SlackPostMessageRequest = z.object({
  channelId: z.string().min(1),
  /** Slack Block Kit blocks (JSON). Falls back to text if blocks omitted. */
  blocks: z.array(z.record(z.unknown())).optional(),
  text: z.string().min(1).max(3000).optional(),
}).refine(
  (v) => v.blocks != null || v.text != null,
  { message: 'At least one of blocks or text is required' },
);
export type SlackPostMessageRequest = z.infer<typeof SlackPostMessageRequest>;

// ─── Zapier ───────────────────────────────────────────────────────────────

export const ZAPIER_EVENT_TYPES = [
  'lead.created',
  'deal.stage_changed',
  'contact.created',
] as const;
export type ZapierEventType = typeof ZAPIER_EVENT_TYPES[number];

export const ZapierSubscribeRequest = z.object({
  eventType: z.enum(ZAPIER_EVENT_TYPES),
  webhookUrl: z.string().url(),
});
export type ZapierSubscribeRequest = z.infer<typeof ZapierSubscribeRequest>;

export const ZapierSubscribeResponse = z.object({
  id: z.string().uuid(),
  eventType: z.string(),
  webhookUrl: z.string(),
  createdAt: z.string().datetime(),
});
export type ZapierSubscribeResponse = z.infer<typeof ZapierSubscribeResponse>;

export const ZapierAuthRequest = z.object({
  apiKey: z.string().min(32).max(128),
});
export type ZapierAuthRequest = z.infer<typeof ZapierAuthRequest>;

export const ZapierAuthResponse = z.object({
  orgId: z.string().uuid(),
  orgName: z.string(),
});
export type ZapierAuthResponse = z.infer<typeof ZapierAuthResponse>;

export const ZapierCreateDealAction = z.object({
  title: z.string().min(1).max(255),
  value: z.number().optional(),
  currency: z.string().length(3).optional(),
  contactEmail: z.string().email().optional(),
});
export type ZapierCreateDealAction = z.infer<typeof ZapierCreateDealAction>;

export const ZapierCreateContactAction = z.object({
  email: z.string().email(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  phone: z.string().optional(),
  companyName: z.string().optional(),
});
export type ZapierCreateContactAction = z.infer<typeof ZapierCreateContactAction>;

export const ZapierLogActivityAction = z.object({
  entityType: z.enum(['deal', 'contact', 'lead']),
  entityId: z.string().uuid(),
  activityType: z.string().min(1).max(64),
  note: z.string().max(5000).optional(),
});
export type ZapierLogActivityAction = z.infer<typeof ZapierLogActivityAction>;

export const ZapierActionResponse = z.object({
  id: z.string().uuid(),
  createdAt: z.string().datetime(),
});
export type ZapierActionResponse = z.infer<typeof ZapierActionResponse>;

// ─── Zapier manifest type (public app definition) ─────────────────────────

export interface ZapierManifestTrigger {
  key: string;
  noun: string;
  display: { label: string; description: string };
  operation: {
    type: 'hook' | 'polling';
    performSubscribe?: string;
    performUnsubscribe?: string;
    perform: string;
    sample: Record<string, unknown>;
  };
}

export interface ZapierManifestAction {
  key: string;
  noun: string;
  display: { label: string; description: string };
  operation: {
    perform: string;
    inputFields: Array<{ key: string; label: string; type: string; required?: boolean }>;
    sample: Record<string, unknown>;
  };
}
