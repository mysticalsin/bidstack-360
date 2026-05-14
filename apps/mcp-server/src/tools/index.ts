import type { z } from 'zod';
import type { McpAuthCtx } from '../auth.js';

import { opportunitiesList } from './opportunities-list.js';
import { opportunitiesGet } from './opportunities-get.js';
import { opportunityUpdate } from './opportunity-update.js';
import { contactsList } from './contacts-list.js';
import { contactsGet } from './contacts-get.js';
import { contactsCreate } from './contacts-create.js';
import { tasksCreate } from './tasks-create.js';
import { tasksList } from './tasks-list.js';
import { tasksUpdate } from './tasks-update.js';
import { proposalDraft } from './proposal-draft.js';
import { leadsList } from './leads-list.js';
import { leadsGet } from './leads-get.js';
import { leadsCreate } from './leads-create.js';
import { leadsUpdate } from './leads-update.js';
import { leadsConvert } from './leads-convert.js';
import { notesList } from './notes-list.js';
import { notesCreate } from './notes-create.js';
import {
  crmSearchCompanies,
  crmCreateDeal,
  crmUpdateDeal,
  crmEnrichCompany,
  crmListActivities,
  crmCreateActivity,
  crmGenerateInsights,
} from './crm-tools.js';

export interface Tool<I extends z.ZodTypeAny = z.ZodTypeAny, O = unknown> {
  description: string;
  input: I;
  inputJsonSchema: Record<string, unknown>;
  handler: (args: z.infer<I>, ctx: McpAuthCtx) => Promise<O>;
}

// Tool naming: the legacy dotted names ('opportunities.list', etc.) are the
// MCP server's native shape. The Dust integration spec (see
// packages/shared/src/schemas/crm.ts → DustCrmToolName) names the same
// concepts as snake-cased 'crm_*' identifiers. We expose BOTH spellings to
// the registry so Dust's tool catalog and the existing MCP catalog resolve
// without translation. Handlers are shared — only the dictionary key
// differs.
export const tools = {
  // Legacy dotted names (kept for backward compatibility with v0.1 clients)
  'opportunities.list': opportunitiesList,
  'opportunities.get': opportunitiesGet,
  'opportunity.update': opportunityUpdate,
  'contacts.list': contactsList,
  'contacts.get': contactsGet,
  'contacts.create': contactsCreate,
  'tasks.create': tasksCreate,
  'tasks.list': tasksList,
  'tasks.update': tasksUpdate,
  'proposal.draft': proposalDraft,
  'leads.list': leadsList,
  'leads.get': leadsGet,
  'leads.create': leadsCreate,
  'leads.update': leadsUpdate,
  'leads.convert': leadsConvert,
  'notes.list': notesList,
  'notes.create': notesCreate,
  // Canonical CRM surface consumed by Dust (DustCrmToolName enum)
  crm_search_companies: crmSearchCompanies,
  crm_create_deal: crmCreateDeal,
  crm_update_deal: crmUpdateDeal,
  crm_enrich_company: crmEnrichCompany,
  crm_list_activities: crmListActivities,
  crm_create_activity: crmCreateActivity,
  crm_generate_insights: crmGenerateInsights,
} as const;

export type ToolName = keyof typeof tools;
