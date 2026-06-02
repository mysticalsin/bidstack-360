import { z } from 'zod';

export const WEBHOOK_EVENT_KEYS = [
  'lead.created',
  'contact.created',
  'opportunity.created',
  'opportunity.stage_changed',
  'opportunity.score_degraded',
  'proposal.submitted',
  'task.created',
  'task.completed',
  'invoice.sent',
  'invoice.paid',
  'document.extracted',
  'dust.agent.completed',
  'nps.survey_dispatched',
] as const;

export const WebhookEventKeySchema = z.enum(WEBHOOK_EVENT_KEYS);
export type WebhookEventKey = z.infer<typeof WebhookEventKeySchema>;

export interface WebhookEventOption {
  key: WebhookEventKey;
  label: string;
  description: string;
}

export interface WebhookEventGroup {
  group: string;
  description: string;
  events: WebhookEventOption[];
}

export const WEBHOOK_EVENT_GROUPS: WebhookEventGroup[] = [
  {
    group: 'Revenue capture',
    description: 'Pipeline and deal movement that revenue teams need immediately.',
    events: [
      {
        key: 'lead.created',
        label: 'Lead created',
        description: 'A new lead is created in the CRM.',
      },
      {
        key: 'contact.created',
        label: 'Contact created',
        description: 'A new buying-committee contact is added.',
      },
      {
        key: 'opportunity.created',
        label: 'Opportunity created',
        description: 'A new opportunity enters the sales pipeline.',
      },
      {
        key: 'opportunity.stage_changed',
        label: 'Opportunity stage changed',
        description: 'An opportunity moves to another pipeline stage.',
      },
      {
        key: 'opportunity.score_degraded',
        label: 'Opportunity risk increased',
        description: 'Predictive scoring detects a material deal-health drop.',
      },
    ],
  },
  {
    group: 'Bid and delivery',
    description: 'Bid factory, task, and document intelligence events.',
    events: [
      {
        key: 'proposal.submitted',
        label: 'Proposal submitted',
        description: 'A proposal is marked submitted to the customer.',
      },
      {
        key: 'task.created',
        label: 'Task created',
        description: 'A CRM or bid task is created.',
      },
      {
        key: 'task.completed',
        label: 'Task completed',
        description: 'A task moves to done.',
      },
      {
        key: 'document.extracted',
        label: 'Document extracted',
        description: 'A bid/RFP document extraction completes.',
      },
      {
        key: 'dust.agent.completed',
        label: 'Dust agent completed',
        description: 'A connected Dust agent finishes a run.',
      },
    ],
  },
  {
    group: 'Finance and customer signals',
    description: 'Billing and customer-success events for downstream operations.',
    events: [
      {
        key: 'invoice.sent',
        label: 'Invoice sent',
        description: 'An invoice is sent.',
      },
      {
        key: 'invoice.paid',
        label: 'Invoice paid',
        description: 'An invoice payment is recorded.',
      },
      {
        key: 'nps.survey_dispatched',
        label: 'NPS survey dispatched',
        description: 'A customer-success survey is sent.',
      },
    ],
  },
];

export const WEBHOOK_EVENT_SET = new Set<string>(WEBHOOK_EVENT_KEYS);

export function isWebhookEventKey(value: string): value is WebhookEventKey {
  return WEBHOOK_EVENT_SET.has(value);
}
