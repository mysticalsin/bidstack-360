import { z } from 'zod';

import { COMMITMENT_STATUSES } from '../people/commitment.js';
import {
  CONNECTION_STANDINGS,
  DEAL_EVIDENCE,
  FACT_KINDS,
  FACT_STATUSES,
} from '../people/standing.js';

import { TaskStatus } from './task.js';

const ConnectionStanding = z.enum(CONNECTION_STANDINGS);
const FactKind = z.enum(FACT_KINDS);
const FactStatus = z.enum(FACT_STATUSES);
const DealEvidence = z.enum(DEAL_EVIDENCE);
const CommitmentStatus = z.enum(COMMITMENT_STATUSES);

export const PersonFact = z.object({
  id: z.string().uuid(),
  kind: FactKind,
  status: FactStatus,
  claim: z.string(),
  reportsToContactId: z.string().uuid().nullable(),
  opportunityId: z.string().uuid().nullable(),
  companyId: z.string().uuid().nullable(),
  linkLabel: z.string().nullable(),
  evidenceDetail: z.string().nullable(),
  observedAt: z.string().datetime().nullable(),
  stale: z.boolean(),
});
export type PersonFact = z.infer<typeof PersonFact>;

export const DealLink = z.object({
  opportunityId: z.string().uuid(),
  opportunityName: z.string(),
  label: z.string(),
  evidence: DealEvidence,
});
export type DealLink = z.infer<typeof DealLink>;

export const PeopleMapPerson = z.object({
  id: z.string().uuid(),
  name: z.string(),
  /** Job title on the contact. Display only — never decision authority. */
  title: z.string().nullable(),
  standing: ConnectionStanding,
  reportsToContactId: z.string().uuid().nullable(),
  reportsToName: z.string().nullable(),
  dealLinks: z.array(DealLink),
  facts: z.array(PersonFact),
});
export type PeopleMapPerson = z.infer<typeof PeopleMapPerson>;

export const PeopleMap = z.object({
  companyId: z.string().uuid().nullable(),
  opportunityId: z.string().uuid().nullable(),
  people: z.array(PeopleMapPerson),
  /** True when the list is the first 1,000 people by name. */
  peopleCapped: z.boolean().optional(),
  /** True when evidence is the latest 1,000 facts. */
  factsCapped: z.boolean().optional(),
  /** True when deal links are the latest 1,000. */
  dealsCapped: z.boolean().optional(),
  /** True when a reporting name was not in the loaded page. */
  namesCapped: z.boolean().optional(),
});
export type PeopleMap = z.infer<typeof PeopleMap>;

export const PEOPLE_MAP_PAGE = 1000;

const groupedCount = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/** Names only the pages that filled, so a complete buying group stays silent. */
export function peopleMapPageNotes(caps: {
  peopleCapped?: boolean;
  factsCapped?: boolean;
  dealsCapped?: boolean;
  namesCapped?: boolean;
} | null | undefined): string[] {
  const page = groupedCount(PEOPLE_MAP_PAGE);
  return [
    caps?.peopleCapped ? `First ${page} people by name.` : '',
    caps?.factsCapped ? `Evidence is the latest ${page} facts.` : '',
    caps?.dealsCapped ? `Deal links are the latest ${page}.` : '',
    caps?.namesCapped ? 'Some reporting names are outside this page.' : '',
  ].filter((note) => note.length > 0);
}

export const ContactFactCreate = z.object({
  kind: FactKind,
  claim: z.string().min(1).max(2000),
  reportsToContactId: z.string().uuid().nullable().optional(),
  opportunityId: z.string().uuid().nullable().optional(),
  companyId: z.string().uuid().nullable().optional(),
  linkLabel: z.string().min(1).max(80).nullable().optional(),
  evidenceDetail: z.string().max(2000).nullable().optional(),
  observedAt: z.string().datetime().nullable().optional(),
  ambiguous: z.boolean().optional(),
});
export type ContactFactCreate = z.infer<typeof ContactFactCreate>;

export const FactDecisionBody = z.object({
  decision: z.enum(['accept', 'dismiss']),
  reportsToContactId: z.string().uuid().nullable().optional(),
  opportunityId: z.string().uuid().nullable().optional(),
  companyId: z.string().uuid().nullable().optional(),
  linkLabel: z.string().min(1).max(80).nullable().optional(),
});
export type FactDecisionBody = z.infer<typeof FactDecisionBody>;

export const CustomerCommitmentRow = z.object({
  recordKind: z.literal('customer_commitment'),
  id: z.string().uuid(),
  promise: z.string(),
  dueDate: z.string().date().nullable(),
  status: CommitmentStatus,
  ownerContactId: z.string().uuid().nullable(),
  ownerName: z.string().nullable(),
  opportunityId: z.string().uuid().nullable(),
  sourceNote: z.string().nullable(),
});
export type CustomerCommitmentRow = z.infer<typeof CustomerCommitmentRow>;

export const InternalTaskRow = z.object({
  recordKind: z.literal('internal_task'),
  id: z.string().uuid(),
  title: z.string(),
  dueDate: z.string().date().nullable(),
  status: TaskStatus,
  assigneeEmail: z.string().nullable(),
});
export type InternalTaskRow = z.infer<typeof InternalTaskRow>;

export const AccountWork = z.object({
  commitments: z.array(CustomerCommitmentRow),
  internalTasks: z.array(InternalTaskRow),
});
export type AccountWork = z.infer<typeof AccountWork>;

export const CustomerCommitmentCreate = z.object({
  promise: z.string().min(1).max(2000),
  dueDate: z.string().date().nullable().optional(),
  ownerContactId: z.string().uuid().nullable().optional(),
  opportunityId: z.string().uuid().nullable().optional(),
  sourceNote: z.string().max(4000).nullable().optional(),
  ambiguous: z.boolean().optional(),
});
export type CustomerCommitmentCreate = z.infer<typeof CustomerCommitmentCreate>;

export const CustomerCommitmentPatch = z
  .object({
    promise: z.string().min(1).max(2000).optional(),
    dueDate: z.string().date().nullable().optional(),
    ownerContactId: z.string().uuid().nullable().optional(),
    opportunityId: z.string().uuid().nullable().optional(),
    status: CommitmentStatus.optional(),
    sourceNote: z.string().max(4000).nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'PATCH body must contain at least one field',
  });
export type CustomerCommitmentPatch = z.infer<typeof CustomerCommitmentPatch>;
