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
import { spotlightRef } from './spotlight-ref.js';
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
import {
  kamListAccounts,
  kamListInitiatives,
  kamIngestTranscript,
  kamProposeSessionDraft,
  kamUpdateTaskStatus,
} from './kam-tools.js';

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
  spotlight_ref: spotlightRef,
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
  // KAM front layer. Write tools use the dedicated `kam` scope (see ToolScope)
  // so a KAM agent key cannot reach the canonical-write tools above.
  kam_list_accounts: kamListAccounts,
  kam_list_initiatives: kamListInitiatives,
  kam_ingest_transcript: kamIngestTranscript,
  kam_propose_session_draft: kamProposeSessionDraft,
  kam_update_task_status: kamUpdateTaskStatus,
} as const;

export type ToolName = keyof typeof tools;

// `kam` is a dedicated staging scope: it grants KAM ingest/propose/status-update
// WITHOUT granting `write` (which canonical-mutating tools require). A Dust KAM
// agent key holds ['read','kam'] and therefore cannot call leads.create etc.
export type ToolScope = 'read' | 'write' | 'kam';

export const toolScopes = {
  'opportunities.list': 'read',
  'opportunities.get': 'read',
  'opportunity.update': 'write',
  'contacts.list': 'read',
  'contacts.get': 'read',
  'contacts.create': 'write',
  'tasks.create': 'write',
  'tasks.list': 'read',
  'tasks.update': 'write',
  'proposal.draft': 'read',
  spotlight_ref: 'read',
  'leads.list': 'read',
  'leads.get': 'read',
  'leads.create': 'write',
  'leads.update': 'write',
  'leads.convert': 'write',
  'notes.list': 'read',
  'notes.create': 'write',
  crm_search_companies: 'read',
  crm_create_deal: 'write',
  crm_update_deal: 'write',
  crm_enrich_company: 'write',
  crm_list_activities: 'read',
  crm_create_activity: 'write',
  crm_generate_insights: 'read',
  kam_list_accounts: 'read',
  kam_list_initiatives: 'read',
  kam_ingest_transcript: 'kam',
  kam_propose_session_draft: 'kam',
  kam_update_task_status: 'kam',
} satisfies Record<ToolName, ToolScope>;

export function requiredScopeForTool(name: ToolName): ToolScope {
  return toolScopes[name];
}
