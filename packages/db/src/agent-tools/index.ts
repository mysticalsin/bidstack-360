// Shared agent tool registry: one definition, served by the MCP server
// (apps/mcp-server/src/tools) and by Jarvis (apps/api, ai-assistant jarvis
// routes). Handlers are org-scoped by ctx.orgId; callers own authentication
// and authorization (MCP: API-key scope; Jarvis: user RBAC via `permission`).
import {
  accountDirection,
  accountFinancialsSummary,
  accountHiring,
  accountNews,
} from './account-intel.js';
import { bidsOverdue, proposalSectionDraft, proposalStatus } from './bids.js';
import { msaWhitespace, relationshipMap } from './msa-whitespace.js';
import { opportunitiesGet, opportunitiesList, opportunityUpdate } from './opportunities.js';
import { accountUpdates, recordsResolve } from './records.js';
import { rfpSummary } from './rfp.js';
import { tasksCreate } from './tasks.js';
import type { AgentTool } from './types.js';

export const agentTools = {
  'records.resolve': recordsResolve,
  'account.updates': accountUpdates,
  'proposal.status': proposalStatus,
  'rfp.summary': rfpSummary,
  'bids.overdue': bidsOverdue,
  'opportunities.list': opportunitiesList,
  'opportunities.get': opportunitiesGet,
  'tasks.create': tasksCreate,
  'opportunity.update': opportunityUpdate,
  'proposal.section_draft': proposalSectionDraft,
  account_direction: accountDirection,
  account_hiring: accountHiring,
  account_financials_summary: accountFinancialsSummary,
  account_news: accountNews,
  msa_whitespace: msaWhitespace,
  relationship_map: relationshipMap,
} as const satisfies Record<string, AgentTool>;

export type AgentToolName = keyof typeof agentTools;

export const AGENT_TOOL_NAMES = Object.keys(agentTools) as AgentToolName[];

export {
  accountDirection,
  accountFinancialsSummary,
  accountHiring,
  accountNews,
  accountUpdates,
  bidsOverdue,
  msaWhitespace,
  opportunitiesGet,
  opportunitiesList,
  opportunityUpdate,
  proposalSectionDraft,
  proposalStatus,
  recordsResolve,
  relationshipMap,
  rfpSummary,
  tasksCreate,
};
export { activityText, auditText, movedText } from './timeline-text.js';
export type {
  AgentChange,
  AgentCitation,
  AgentTool,
  AgentToolCtx,
  AgentToolKind,
  AgentToolPreview,
} from './types.js';
