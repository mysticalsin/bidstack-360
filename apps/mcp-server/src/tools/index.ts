import type { z } from 'zod';
import type { McpAuthCtx } from '../auth.js';

import { opportunitiesList } from './opportunities-list.js';
import { opportunitiesGet } from './opportunities-get.js';
import { opportunityUpdate } from './opportunity-update.js';
import { contactsList } from './contacts-list.js';
import { tasksCreate } from './tasks-create.js';
import { proposalDraft } from './proposal-draft.js';
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
  'tasks.create': tasksCreate,
  'proposal.draft': proposalDraft,
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
