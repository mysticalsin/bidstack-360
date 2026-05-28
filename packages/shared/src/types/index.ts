// Re-export inferred types from schemas under a single namespace import path.
// Use `import type { Opportunity } from '@bidstack/shared'` from anywhere.
export type {
  Opportunity,
  OpportunityCreate,
  OpportunityPatch,
  OpportunityFilter,
  OpportunityPage,
  PipelineStage,
  Industry,
} from '../schemas/opportunity.js';

export type { Contact, ContactCreate, Sentiment } from '../schemas/contact.js';
export type { Task, TaskCreate, TaskPatch, TaskStatus } from '../schemas/task.js';
export type { PermissionKey } from './permissions.js';
export { PERMISSION_KEYS, isPermissionKey } from './permissions.js';
export type { SystemRoleName, MatrixResource } from './rbac-matrix.js';
export { SYSTEM_ROLE_NAMES, RBAC_MATRIX, MATRIX_RESOURCES } from './rbac-matrix.js';
export type {
  IntelPayload,
  Financial,
  Trigger,
  DecisionMember,
  Competitor,
  NewsItem,
  HiringSignal,
  WinPrediction,
} from '../schemas/intel.js';

export type {
  Tag,
  TagCreate,
  TagPatch,
  TagList,
  TagApply,
  EntityTagsResponse,
  TagSuggestion,
  TagSuggestRequest,
  TagSuggestResponse,
  TaggableEntityType,
} from '../schemas/tag.js';

export type {
  EmailTemplate,
  EmailTemplateCreate,
  EmailTemplatePatch,
  EmailTemplateList,
  EmailTemplateRenderRequest,
  EmailTemplateRenderResponse,
} from '../schemas/email-template.js';

export type {
  LeadStageRotConfig,
  LeadStageRotConfigUpsert,
  LeadStageRotConfigList,
  RecoverySuggestResponse,
} from '../schemas/lead-rot.js';

export type {
  RfpAgentAssignment,
  RfpAgentAssignmentStatus,
  RfpAgentAssignmentWithAgent,
  RfpAgentAssignmentCreate,
  RfpAgentAssignmentListResult,
  RfpAgentOutput,
  RfpAgentOutputStatus,
  RfpAgentOutputListResult,
  RfpAgentTask,
  RfpAgentTaskStatus,
  RfpAgentTaskListResult,
} from '../schemas/rfp-agent-assignment.js';
