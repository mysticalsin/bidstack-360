// Org chart model used by the UI. Live charts come from the org chart API
// (/workspace/fleet/polo-orgchart-api.md, @bidstack/shared OrgChartNode) and
// are mapped onto this shape in ./client.ts; unsaved accounts get a Sample.
import type { OrgChartProfile, OrgChartSource, SeniorityLevel } from '@bidstack/shared';

export type OrgNodeSource = OrgChartSource | 'sample' | 'meetings';

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
  phone?: string | null;
  linkedinUrl?: string | null;
  /** Extra imported profile (location, tenure, career...), display only. */
  profile?: OrgChartProfile | null;
  /** Our relationship owner, when set by hand. Otherwise derived from meetings. */
  ownerName: string | null;
  source: OrgNodeSource;
  /** Server fields (live charts only). */
  version?: number;
  kind?: 'contact' | 'placeholder';
  function?: string | null;
  redacted?: boolean;
  meetingCount?: number;
  lastMetAt?: string | null;
  relationshipStrength?: number | null;
}

export interface OrgChart {
  companyId: string;
  rootId: string | null;
  version: number;
  updatedAt: string | null;
  updatedBy: string | null;
  /** True for a generated sample structure that nobody has saved yet. */
  sample: boolean;
  /** True when the depth limit cut nodes off (load deeper with fromNodeId). */
  truncated?: boolean;
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

/** What the chart shows per person: met coverage plus, when loaded, meetings. */
export interface NodeCov {
  met: boolean;
  count: number;
  lastMetAt: string | null;
  meetings: Array<{ id: string; title: string; heldAt: string }>;
  challenges: string[];
  /** Internal attendees who met this person, most frequent first. */
  owners: string[];
  /** Admin-set relationship strength (1 to 5), overrides the derived one. */
  manual: number | null;
}

/** 409 version_conflict from the API: someone changed the chart first. */
export class OrgChartConflictError extends Error {
  constructor(public current: { chartVersion: number | null; currentVersion: number | null; message: string }) {
    super(current.message || 'Someone else changed this org chart first');
  }
}
