// Org chart model. Mirrors the expected backend contract
// (/workspace/fleet/polo-orgchart-api.md, not written yet); until it lands the
// client in ./client.ts is a local mock.
import type { SeniorityLevel } from '@bidstack/shared';

export type OrgNodeSource = 'sample' | 'manual' | 'contacts' | 'meetings' | 'csv' | 'apollo';

export interface OrgNode {
  id: string;
  parentId: string | null;
  name: string;
  title: string | null;
  photoUrl: string | null;
  seniority: SeniorityLevel;
  region: string | null;
  contactId: string | null;
  email: string | null;
  /** Our relationship owner, when set by hand. Otherwise derived from meetings. */
  ownerName: string | null;
  source: OrgNodeSource;
}

export interface OrgChart {
  companyId: string;
  rootId: string | null;
  version: number;
  updatedAt: string | null;
  updatedBy: string | null;
  /** True for a generated sample structure that nobody has saved yet. */
  sample: boolean;
  nodes: OrgNode[];
}

export type Strength = 'strong' | 'medium' | 'weak' | 'none';

export interface PersonCoverage {
  key: string;
  name: string;
  title: string | null;
  seniority: SeniorityLevel;
  region: string | null;
  contactId: string | null;
  reportsToContactId: string | null;
  meetings: Array<{ id: string; title: string; heldAt: string }>;
  challenges: string[];
  /** Internal attendees who met this person, most frequent first. */
  owners: string[];
  lastMetAt: string | null;
}

export class OrgChartConflictError extends Error {
  constructor(public current: Pick<OrgChart, 'version' | 'updatedAt' | 'updatedBy'>) {
    super('Someone else saved this org chart first');
  }
}
