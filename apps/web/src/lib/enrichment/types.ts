// Company enrichment (firmographics, hiring, inferred projects).
// Provisional shape: the backend contract lands in
// /workspace/fleet/polo-enrichment-api.md. Until then the client serves mock
// data and every surface carries a "Sample" label. Every field is Sourced:
// it says where it came from and as of when.

export interface Sourced<T> {
  value: T;
  /** Human label, e.g. "Annual report", "LinkedIn Jobs", "Company website". */
  source: string;
  /** ISO date the value was observed or published. */
  asOf: string;
  sourceUrl?: string;
}

export type RoleFunction = 'Engineering' | 'Data & AI' | 'Product' | 'Operations' | 'Sales' | 'Finance' | 'Risk & Compliance' | 'HR';
export type RoleSeniority = 'Entry' | 'Mid' | 'Senior' | 'Lead' | 'Director+';

export interface OpenRole {
  id: string;
  title: string;
  function: RoleFunction;
  seniority: RoleSeniority;
  region: string;
  location: string;
  postedAt: string;
  source: string;
  url?: string;
}

export type Confidence = 'high' | 'medium' | 'low';

export interface PotentialProject {
  id: string;
  title: string;
  summary: string;
  confidence: Confidence;
  /** 0–1, shown as a percentage next to the confidence band. */
  score: number;
  inferredAt: string;
  source: string;
  /** OpenRole ids that support the inference. */
  evidence: string[];
}

export interface CompanyEnrichment {
  companyId: string;
  /** True while the API is not wired: the UI must label the data "Sample". */
  sample: boolean;
  firmographics: {
    revenue: Sourced<{ amount: number; currency: string; fiscalYear: string }> | null;
    headcount: Sourced<{ current: number; trend: Array<{ month: string; value: number }> }> | null;
    industry: Sourced<string> | null;
    locations: Sourced<Array<{ city: string; country: string; hq?: boolean }>> | null;
  };
  hiring: { source: string; asOf: string; roles: OpenRole[] };
  projects: PotentialProject[];
}
