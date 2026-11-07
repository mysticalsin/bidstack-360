// Shared agent tool registry: one definition, served by the MCP server
// (apps/mcp-server/src/tools) and by Jarvis (apps/api, ai-assistant jarvis
// routes). Handlers are org-scoped by ctx.orgId; callers own authentication
// and authorization (MCP: API-key scope; Jarvis: user RBAC via `permission`).
import { bidsOverdue, proposalSectionDraft, proposalStatus } from './bids.js';
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
} as const satisfies Record<string, AgentTool>;

export type AgentToolName = keyof typeof agentTools;

export const AGENT_TOOL_NAMES = Object.keys(agentTools) as AgentToolName[];

export {
  accountUpdates,
  bidsOverdue,
  opportunitiesGet,
  opportunitiesList,
  opportunityUpdate,
  proposalSectionDraft,
  proposalStatus,
  recordsResolve,
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
