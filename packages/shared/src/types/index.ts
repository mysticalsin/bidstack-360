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
