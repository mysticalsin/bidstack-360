// Server-side per-entity field maps for the analytics engine.
//
// SECURITY: these constants are the ONLY source of SQL identifiers (tables +
// columns) the engine will ever emit. Any field/sort/groupBy/aggregate key
// not present here is rejected with a 400 before SQL is built. Values are
// always bound as parameters — never interpolated.
//
// Built from the REAL Prisma schema (packages/db/prisma/schema.prisma); the
// FieldPicker fallback enums in apps/web are stale — this map wins.
import type { AnalyticsEntityType, AnalyticsFieldDef } from '@bidstack/shared';

export type AnalyticsFieldType = AnalyticsFieldDef['type'];

export interface AnalyticsFieldSpec {
  key: string;
  label: string;
  type: AnalyticsFieldType;
  /** snake_case column identifier — must match the @@map'd Postgres column. */
  column: string;
  /** WHY: Postgres enum columns need a ::text cast before text comparison. */
  isDbEnum?: boolean;
  enumValues?: string[];
}

export interface AnalyticsEntitySpec {
  /** Postgres table name (@@map). */
  table: string;
  /** All seven analytics tables carry deleted_at; kept explicit for clarity. */
  softDelete: boolean;
  fields: ReadonlyArray<AnalyticsFieldSpec>;
}

const LEAD_FIELDS: AnalyticsFieldSpec[] = [
  { key: 'firstName', label: 'First name', type: 'string', column: 'first_name' },
  { key: 'lastName', label: 'Last name', type: 'string', column: 'last_name' },
  { key: 'email', label: 'Email', type: 'string', column: 'email' },
  { key: 'companyName', label: 'Company', type: 'string', column: 'company_name' },
  { key: 'title', label: 'Title', type: 'string', column: 'title' },
  { key: 'source', label: 'Source', type: 'string', column: 'source' },
  {
    key: 'status',
    label: 'Status',
    type: 'enum',
    column: 'status',
    isDbEnum: true,
    enumValues: ['new', 'contacted', 'qualified', 'nurture', 'disqualified', 'converted'],
  },
  { key: 'score', label: 'Score', type: 'number', column: 'score' },
  {
    key: 'priority',
    label: 'Priority',
    type: 'enum',
    column: 'priority',
    isDbEnum: true,
    enumValues: ['low', 'medium', 'high', 'critical'],
  },
  { key: 'budget', label: 'Budget (BANT)', type: 'string', column: 'budget' },
  { key: 'authority', label: 'Authority (BANT)', type: 'string', column: 'authority' },
  { key: 'need', label: 'Need (BANT)', type: 'string', column: 'need' },
  { key: 'timeline', label: 'Timeline (BANT)', type: 'string', column: 'timeline' },
  { key: 'convertedAt', label: 'Converted at', type: 'date', column: 'converted_at' },
  { key: 'statusChangedAt', label: 'Status changed', type: 'date', column: 'status_changed_at' },
  { key: 'createdAt', label: 'Created', type: 'date', column: 'created_at' },
  { key: 'updatedAt', label: 'Updated', type: 'date', column: 'updated_at' },
];

const OPPORTUNITY_FIELDS: AnalyticsFieldSpec[] = [
  { key: 'code', label: 'Code', type: 'string', column: 'code' },
  { key: 'customer', label: 'Customer', type: 'string', column: 'customer' },
  { key: 'name', label: 'Name', type: 'string', column: 'name' },
  {
    key: 'stage',
    label: 'Stage',
    type: 'enum',
    column: 'stage',
    isDbEnum: true,
    enumValues: [
      's1_lead',
      's1_ongoing',
      's2_sent',
      's3_technical_iteration',
      's4_negotiation',
      'closed_won',
      'closed_lost',
    ],
  },
  // Money is stored in micros (integer x 1e6); emitted raw — format at the edge.
  { key: 'valueMicros', label: 'Value (micros)', type: 'number', column: 'value_micros' },
  { key: 'probability', label: 'Probability', type: 'number', column: 'probability' },
  { key: 'dueDate', label: 'Due date', type: 'date', column: 'due_date' },
  { key: 'industry', label: 'Industry', type: 'string', column: 'industry' },
  { key: 'country', label: 'Country', type: 'string', column: 'country' },
  { key: 'viewCount', label: 'Views', type: 'number', column: 'view_count' },
  { key: 'createdAt', label: 'Created', type: 'date', column: 'created_at' },
  { key: 'updatedAt', label: 'Updated', type: 'date', column: 'updated_at' },
];

const CONTACT_FIELDS: AnalyticsFieldSpec[] = [
  { key: 'name', label: 'Name', type: 'string', column: 'name' },
  { key: 'customer', label: 'Customer', type: 'string', column: 'customer' },
  { key: 'role', label: 'Role', type: 'string', column: 'role' },
  { key: 'email', label: 'Email', type: 'string', column: 'email' },
  { key: 'phone', label: 'Phone', type: 'string', column: 'phone' },
  { key: 'influence', label: 'Influence', type: 'number', column: 'influence' },
  {
    key: 'sentiment',
    label: 'Sentiment',
    type: 'enum',
    column: 'sentiment',
    isDbEnum: true,
    enumValues: ['hot', 'warm', 'neutral', 'cold'],
  },
  { key: 'aiOptOut', label: 'AI opt-out', type: 'boolean', column: 'ai_opt_out' },
  { key: 'createdAt', label: 'Created', type: 'date', column: 'created_at' },
];

const COMPANY_FIELDS: AnalyticsFieldSpec[] = [
  { key: 'name', label: 'Name', type: 'string', column: 'name' },
  { key: 'legalName', label: 'Legal name', type: 'string', column: 'legal_name' },
  { key: 'domain', label: 'Domain', type: 'string', column: 'domain' },
  { key: 'industry', label: 'Industry', type: 'string', column: 'industry' },
  { key: 'employeeCount', label: 'Employees', type: 'number', column: 'employee_count' },
  { key: 'countryCode', label: 'Country', type: 'string', column: 'country_code' },
  { key: 'source', label: 'Source', type: 'string', column: 'source' },
  { key: 'confidence', label: 'Confidence', type: 'number', column: 'confidence' },
  {
    key: 'tier',
    label: 'Account tier',
    type: 'enum',
    column: 'tier',
    isDbEnum: true,
    enumValues: ['key', 'top', 'standard'],
  },
  { key: 'topAccountRank', label: 'Top account rank', type: 'number', column: 'top_account_rank' },
  { key: 'createdAt', label: 'Created', type: 'date', column: 'created_at' },
  { key: 'updatedAt', label: 'Updated', type: 'date', column: 'updated_at' },
];

const TASK_FIELDS: AnalyticsFieldSpec[] = [
  { key: 'title', label: 'Title', type: 'string', column: 'title' },
  {
    key: 'status',
    label: 'Status',
    type: 'enum',
    column: 'status',
    isDbEnum: true,
    enumValues: ['open', 'in_progress', 'done', 'blocked'],
  },
  { key: 'dueDate', label: 'Due date', type: 'date', column: 'due_date' },
  { key: 'createdAt', label: 'Created', type: 'date', column: 'created_at' },
];

const ACTIVITY_FIELDS: AnalyticsFieldSpec[] = [
  {
    key: 'type',
    label: 'Type',
    type: 'enum',
    column: 'type',
    isDbEnum: true,
    enumValues: [
      'email',
      'meeting',
      'call',
      'note',
      'task',
      'stage_change',
      'field_edit',
      'file_upload',
      'task_completed',
      'email_opened',
      'email_clicked',
      'cadence_started',
      'cadence_completed',
      'custom',
    ],
  },
  { key: 'subject', label: 'Subject', type: 'string', column: 'subject' },
  {
    key: 'status',
    label: 'Status',
    type: 'enum',
    column: 'status',
    isDbEnum: true,
    enumValues: ['planned', 'completed', 'cancelled'],
  },
  { key: 'entityType', label: 'Linked entity', type: 'string', column: 'entity_type' },
  {
    key: 'actorType',
    label: 'Actor type',
    type: 'enum',
    column: 'actor_type',
    isDbEnum: true,
    enumValues: ['user', 'system', 'agent'],
  },
  { key: 'startTime', label: 'Start', type: 'date', column: 'start_time' },
  { key: 'endTime', label: 'End', type: 'date', column: 'end_time' },
  { key: 'occurredAt', label: 'Occurred at', type: 'date', column: 'occurred_at' },
  { key: 'createdAt', label: 'Created', type: 'date', column: 'created_at' },
];

// WHY forecasts: there is no Goal model in the Prisma schema. The closest real
// table is `forecasts` (period / category / amount), so the `goal` entity maps
// there. The server map is authoritative — the FieldPicker fallback is stale.
const GOAL_FIELDS: AnalyticsFieldSpec[] = [
  { key: 'period', label: 'Period', type: 'string', column: 'period' },
  { key: 'category', label: 'Category', type: 'string', column: 'category' },
  { key: 'amountMicros', label: 'Amount (micros)', type: 'number', column: 'amount_micros' },
  { key: 'currency', label: 'Currency', type: 'string', column: 'currency' },
  { key: 'createdAt', label: 'Created', type: 'date', column: 'created_at' },
  { key: 'updatedAt', label: 'Updated', type: 'date', column: 'updated_at' },
];

export const ANALYTICS_ENTITIES: Record<AnalyticsEntityType, AnalyticsEntitySpec> = {
  lead: { table: 'leads', softDelete: true, fields: LEAD_FIELDS },
  opportunity: { table: 'opportunities', softDelete: true, fields: OPPORTUNITY_FIELDS },
  contact: { table: 'contacts', softDelete: true, fields: CONTACT_FIELDS },
  company: { table: 'companies', softDelete: true, fields: COMPANY_FIELDS },
  task: { table: 'tasks', softDelete: true, fields: TASK_FIELDS },
  activity: { table: 'activities', softDelete: true, fields: ACTIVITY_FIELDS },
  goal: { table: 'forecasts', softDelete: true, fields: GOAL_FIELDS },
};

export function getEntitySpec(entity: string): AnalyticsEntitySpec | undefined {
  return Object.prototype.hasOwnProperty.call(ANALYTICS_ENTITIES, entity)
    ? ANALYTICS_ENTITIES[entity as AnalyticsEntityType]
    : undefined;
}

export function getFieldSpec(
  spec: AnalyticsEntitySpec,
  key: string,
): AnalyticsFieldSpec | undefined {
  return spec.fields.find((f) => f.key === key);
}
