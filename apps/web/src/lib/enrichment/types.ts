// Company enrichment as the account page shows it (firmographics, hiring,
// inferred projects). The API shape (packages/shared account-enrichment) is
// mapped onto this in ./live.ts; ./mock.ts builds the same shape as Sample
// data when no provider is configured. Every value is Sourced: it says where
// it came from and as of when.

export interface Sourced<T> {
  value: T;
  /** Human label, e.g. "Apollo", "Seamless.AI", "Annual report". */
  source: string;
  /** ISO date the value was fetched or published. */
  asOf: string;
  sourceUrl?: string;
}

export interface OpenRole {
  id: string;
  title: string;
  /** Display labels ("Data", "Senior", "EMEA"). */
  function: string;
  seniority: string;
  region: string;
  location: string;
  postedAt: string | null;
  source: string;
  url?: string | null;
}

export type Confidence = 'high' | 'medium' | 'low';

export interface PotentialProject {
  id: string;
  title: string;
  summary: string;
  confidence: Confidence;
  /** 0–1. Sample data only; the API reports confidence bands, not scores. */
  score?: number;
  inferredAt: string;
  source: string;
  region?: string;
  /** All postings behind the inference; `evidence` holds up to 10 of them. */
  postingCount: number;
  evidence: OpenRole[];
}

export interface CountRow {
  label: string;
  count: number;
}

export interface CompanyEnrichment {
  companyId: string;
  /** True when no provider data exists (not configured / not enriched yet): the UI labels everything "Sample". */
  sample: boolean;
  /** API status (ok, partial, pending, not_configured, budget_exceeded, ...); 'sample' for pure mock. */
  status: string;
  /** Short plain-language note about the data state, shown under the strip. */
  notice: string | null;
  stale: boolean;
  fetchedAt: string | null;
  firmographics: {
    revenue: Sourced<{ amount: number | null; range?: string | null; currency: string; fiscalYear?: string }> | null;
    headcount: Sourced<{
      current: number | null;
      range?: string | null;
      trend?: Array<{ month: string; value: number }>;
      /** Percentage change over 12 months (11 = +11%). */
      growth12m?: number | null;
    }> | null;
    industry: Sourced<string> | null;
    locations: Sourced<Array<{ city: string; country: string; hq?: boolean }>> | null;
  };
  hiring: {
    source: string;
    asOf: string;
    /** Postings loaded (newest first, capped by the API limit). */
    roles: OpenRole[];
    /** All open postings, which can exceed roles.length. */
    total: number;
    /** Server-side counts over all postings, when available. */
    buckets?: { function: CountRow[]; seniority: CountRow[]; region: CountRow[] };
  };
  projects: PotentialProject[];
}
