import type { z } from 'zod';
import type { McpAuthCtx } from '../auth.js';

import { opportunitiesList } from './opportunities-list.js';
import { opportunitiesGet } from './opportunities-get.js';
import { opportunityUpdate } from './opportunity-update.js';
import { contactsList } from './contacts-list.js';
import { tasksCreate } from './tasks-create.js';
import { proposalDraft } from './proposal-draft.js';

export interface Tool<I extends z.ZodTypeAny = z.ZodTypeAny, O = unknown> {
  description: string;
  input: I;
  inputJsonSchema: Record<string, unknown>;
  handler: (args: z.infer<I>, ctx: McpAuthCtx) => Promise<O>;
}

export const tools = {
  'opportunities.list': opportunitiesList,
  'opportunities.get': opportunitiesGet,
  'opportunity.update': opportunityUpdate,
  'contacts.list': contactsList,
  'tasks.create': tasksCreate,
  'proposal.draft': proposalDraft,
} as const;

export type ToolName = keyof typeof tools;
