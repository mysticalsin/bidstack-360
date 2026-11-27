/**
 * fundingEligibility — derive vendor co-funding programs from an account's
 * technical stack. The stack tells us which OEM funding levers apply to a deal:
 * a Microsoft shop unlocks ECIF, an AWS shop unlocks MAP, a GCP shop unlocks PSF.
 * Pure + deterministic (keyword match on detected tech names) — no LLM.
 * Sample rows and a sample snapshot are fixtures, not a vendor footprint.
 */
import type { TechnicalStackCategory } from '@bidstack/shared';

export interface FundingProgram {
  key: string;
  /** Short program label shown on the badge (e.g. "ECIF"). */
  name: string;
  /** Full program name. */
  fullName: string;
  /** Funding vendor. */
  funder: string;
  /** What the funding offsets. */
  blurb: string;
  /** Detected tech names that qualify the account. */
  matched: string[];
  /** Emphasized program (Microsoft/ECIF is the headline lever for Mantu). */
  primary?: boolean;
}

interface FundingRule extends Omit<FundingProgram, 'matched'> {
  keywords: string[];
}

const RULES: FundingRule[] = [
  {
    key: 'ecif',
    name: 'ECIF',
    fullName: 'Enterprise Commercial Investment Funding',
    funder: 'Microsoft',
    primary: true,
    blurb:
      'Microsoft co-funds qualifying Azure, Modern Work, and Dynamics engagements — offsets assessment, migration, and POC cost on partner-led deals.',
    // Specific tokens only — avoid false positives like SentinelOne (≠ Microsoft
    // Sentinel) or a generic "Teams"/"Fabric".
    keywords: [
      'azure',
      'microsoft',
      'office 365',
      'microsoft 365',
      'm365',
      'dynamics',
      'power bi',
      'power platform',
      'power apps',
      'power automate',
      'sharepoint',
      'microsoft teams',
      'microsoft sentinel',
      'microsoft fabric',
      'synapse',
    ],
  },
  {
    key: 'aws-map',
    name: 'AWS MAP',
    fullName: 'Migration Acceleration Program',
    funder: 'Amazon Web Services',
    blurb: 'AWS funds assessment and migration for qualifying workloads moving to AWS.',
    keywords: ['aws', 'amazon web services', 'amazon ec2', 'amazon s3', 'redshift', 'dynamodb'],
  },
  {
    key: 'gcp-psf',
    name: 'Google PSF',
    fullName: 'Partner Sales Funding',
    funder: 'Google Cloud',
    blurb: 'Google Cloud co-funds partner-led migration and modernization on GCP.',
    keywords: ['google cloud', 'gcp', 'bigquery', 'looker', 'google workspace'],
  },
];

export type FundingRead =
  | { kind: 'programs'; programs: FundingProgram[] }
  | { kind: 'sample' }
  | { kind: 'none' };

function namesFrom(stack: TechnicalStackCategory[], sample: boolean): string[] {
  return stack.flatMap((category) =>
    category.items.filter((item) => item.sample === sample).map((item) => item.name),
  );
}

function programsFor(names: string[]): FundingProgram[] {
  const programs: FundingProgram[] = [];
  for (const rule of RULES) {
    const matched = Array.from(
      new Set(names.filter((name) => rule.keywords.some((keyword) => name.toLowerCase().includes(keyword)))),
    );
    if (matched.length > 0) {
      const { keywords: _keywords, ...program } = rule;
      programs.push({ ...program, matched });
    }
  }
  // Primary (ECIF) first, then by strength of signal.
  return programs.sort(
    (a, b) => Number(Boolean(b.primary)) - Number(Boolean(a.primary)) || b.matched.length - a.matched.length,
  );
}

/** Recorded technologies only. A sample row is a demo fixture, not a vendor footprint. */
export function deriveFundingPrograms(stack: TechnicalStackCategory[]): FundingProgram[] {
  return programsFor(
    stack.flatMap((category) =>
      category.items.filter((item) => item.sample !== true).map((item) => item.name),
    ),
  );
}

/**
 * What the funding card may say. A sample snapshot (coverage.sample, or only
 * sample rows matching a vendor) is not a co-funding recommendation. An
 * observed Azure still counts when a sample Microsoft 365 sits beside it.
 */
export function fundingRead(stack: TechnicalStackCategory[], sampleSnapshot = false): FundingRead {
  if (!sampleSnapshot) {
    const programs = deriveFundingPrograms(stack);
    if (programs.length > 0) return { kind: 'programs', programs };
  }
  const sampleNames = sampleSnapshot
    ? stack.flatMap((category) => category.items.map((item) => item.name))
    : namesFrom(stack, true);
  if (programsFor(sampleNames).length > 0) return { kind: 'sample' };
  return { kind: 'none' };
}
