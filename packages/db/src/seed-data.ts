// Fixtures distilled from the prototype's `src/data.js`.
// Stage names are normalized to the canonical enum.
//
// Tasks, intel, and leads extracted to ./seed-data.tasks-leads.ts (BS-R1).

import { OpportunityStage, Sentiment } from '../generated/client/index.js';

export interface FixtureUser {
  initials: string;
  name: string;
  email: string;
  role: string;
}

export const fixtureUsers: FixtureUser[] = [
  { initials: 'JS', name: 'Jane Smith', email: 'jane.smith@mantu.com', role: 'admin' },
  { initials: 'MT', name: 'Mark Thompson', email: 'mark.thompson@mantu.com', role: 'bid_manager' },
  {
    initials: 'SB',
    name: 'Sarah Bennett',
    email: 'sarah.bennett@mantu.com',
    role: 'solution_arch',
  },
  { initials: 'DL', name: 'David Lee', email: 'david.lee@mantu.com', role: 'solution_arch' },
  { initials: 'MJ', name: 'Mike Johnson', email: 'mike.johnson@mantu.com', role: 'account_exec' },
  { initials: 'RH', name: 'Riya Hassan', email: 'riya.hassan@mantu.com', role: 'account_exec' },
  { initials: 'LB', name: 'Léon Bertrand', email: 'leon.bertrand@mantu.com', role: 'viewer' },
  // Sales-module salespeople (Sprint 21) — match the reference dashboard
  // screenshot so "Top Quotations / Top Sales Orders" credit the right name.
  { initials: 'SP', name: 'Sarah Poncet', email: 'sarah.poncet@mantu.com', role: 'account_exec' },
  { initials: 'TW', name: 'Tony Walteur', email: 'tony.walteur@mantu.com', role: 'account_exec' },
  {
    initials: 'BR',
    name: 'Benjamin Richer',
    email: 'benjamin.richer@mantu.com',
    role: 'account_exec',
  },
];

export interface FixtureOpp {
  code: string;
  customer: string;
  name: string;
  stage: OpportunityStage;
  value: number;
  probability: number;
  dueDate: string | null;
  ownerInitials: string;
  industry: string;
  logoUrl: string | null;
  country: string;
}

export const fixtureOpps: FixtureOpp[] = [
  {
    code: 'OP-2041',
    customer: 'CI Financial',
    name: 'CI Financial — IT Modernization & MSP',
    stage: OpportunityStage.s3_technical_iteration,
    value: 1_240_000,
    probability: 65,
    dueDate: '2026-07-22',
    ownerInitials: 'JS',
    industry: 'financial_services',
    logoUrl: null,
    country: 'CA',
  },
  {
    code: 'OP-2042',
    customer: 'Logistec Corporation',
    name: 'Logistec Corporation — SOC 2 Readiness',
    stage: OpportunityStage.s1_ongoing,
    value: 320_000,
    probability: 35,
    dueDate: '2026-08-15',
    ownerInitials: 'MT',
    industry: 'transportation',
    logoUrl: null,
    country: 'CA',
  },
  {
    code: 'OP-2043',
    customer: 'Rush University System for Health',
    name: 'Rush University — EHR Cloud Migration',
    stage: OpportunityStage.s4_negotiation,
    value: 4_800_000,
    probability: 78,
    dueDate: '2026-06-30',
    ownerInitials: 'JS',
    industry: 'healthcare',
    logoUrl: null,
    country: 'US',
  },
  {
    code: 'OP-2044',
    customer: 'MAPFRE',
    name: 'MAPFRE — Identity & Access Overhaul',
    stage: OpportunityStage.s1_ongoing,
    value: 680_000,
    probability: 20,
    dueDate: '2026-09-30',
    ownerInitials: 'SB',
    industry: 'insurance',
    logoUrl: null,
    country: 'ES',
  },
  {
    code: 'OP-2045',
    customer: 'MAHLE',
    name: 'MAHLE — OT/IT Convergence',
    stage: OpportunityStage.s2_sent,
    value: 2_150_000,
    probability: 55,
    dueDate: '2026-08-01',
    ownerInitials: 'DL',
    industry: 'manufacturing',
    logoUrl: null,
    country: 'DE',
  },
  {
    code: 'OP-2046',
    customer: 'Aritzia',
    name: 'Aritzia — Endpoint Refresh',
    stage: OpportunityStage.closed_won, // prototype: "won"
    value: 410_000,
    probability: 100,
    dueDate: '2026-04-28',
    ownerInitials: 'MT',
    industry: 'retail',
    logoUrl: null,
    country: 'CA',
  },
  {
    code: 'OP-2047',
    customer: 'NOS',
    name: 'NOS — SOC build-out',
    stage: OpportunityStage.closed_lost, // prototype: "lost"
    value: 1_900_000,
    probability: 0,
    dueDate: '2026-04-12',
    ownerInitials: 'SB',
    industry: 'telecom',
    logoUrl: null,
    country: 'PT',
  },
  {
    code: 'OP-2048',
    customer: 'DNB Bank',
    name: 'DNB Bank — Cloud landing zone',
    stage: OpportunityStage.s1_ongoing,
    value: 2_700_000,
    probability: 40,
    dueDate: '2026-09-15',
    ownerInitials: 'JS',
    industry: 'financial_services',
    logoUrl: null,
    country: 'NO',
  },
];

export interface FixtureCompanyEnrichment {
  normalizedName: string;
  legalName: string;
  tradeName: string | null;
  domain: string | null;
  website: string | null;
  logoUrl: string | null;
  logoSource: string | null;
  status: string | null;
  employeeCount: number | null;
  annualRevenueMicros: bigint | null;
  confidenceBps: number;
  sourceAttribution: Record<string, unknown>[];
  providerMetadata: Record<string, unknown>;
}

export const fixtureCompanyEnrichments: FixtureCompanyEnrichment[] = [
  {
    normalizedName: 'mantu',
    legalName: 'Mantu',
    tradeName: 'Mantu',
    domain: 'mantu.com',
    website: 'https://mantu.com/',
    logoUrl: 'https://mantu.com/favicon.ico',
    logoSource: 'official_website',
    status: 'active',
    employeeCount: 12_000,
    annualRevenueMicros: 1_000_000_000_000_000n,
    confidenceBps: 9900,
    sourceAttribution: [
      {
        source: 'official_website',
        label: 'Mantu official website',
        sourceUrl: 'https://mantu.com/',
        fetchedAt: '2026-05-11T00:00:00.000Z',
        confidence: 0.99,
        providerMetadata: {
          description:
            'Independent global consulting group delivering technology, talent, creative intelligence, and leadership advisory services.',
        },
      },
    ],
    providerMetadata: { country: 'FR', verified: true },
  },
  {
    normalizedName: 'ci-financial',
    legalName: 'CI Financial Corp.',
    tradeName: 'CI Financial',
    domain: 'ci.com',
    website: 'https://www.ci.com/',
    logoUrl: 'https://www.ci.com/favicon.ico',
    logoSource: 'favicon',
    status: 'active',
    employeeCount: 2500,
    annualRevenueMicros: 1_200_000_000_000_000n,
    confidenceBps: 8700,
    sourceAttribution: [
      {
        source: 'seed_verified_profile',
        label: 'BidStack seed profile',
        sourceUrl: 'https://www.ci.com/',
        fetchedAt: '2026-05-11T00:00:00.000Z',
        confidence: 0.87,
        providerMetadata: { country: 'CA', industry: 'financial_services' },
      },
    ],
    providerMetadata: { country: 'CA' },
  },
  {
    normalizedName: 'rush-university-system-for-health',
    legalName: 'Rush University System for Health',
    tradeName: 'Rush University System for Health',
    domain: 'rush.edu',
    website: 'https://www.rush.edu/',
    logoUrl: 'https://www.rush.edu/favicon.ico',
    logoSource: 'favicon',
    status: 'active',
    employeeCount: 14_000,
    annualRevenueMicros: null,
    confidenceBps: 8200,
    sourceAttribution: [
      {
        source: 'seed_verified_profile',
        label: 'BidStack seed profile',
        sourceUrl: 'https://www.rush.edu/',
        fetchedAt: '2026-05-11T00:00:00.000Z',
        confidence: 0.82,
        providerMetadata: { country: 'US', industry: 'healthcare' },
      },
    ],
    providerMetadata: { country: 'US' },
  },
];

// Curated Company spec (F2). One canonical Company per DISTINCT opportunity
// customer — never auto-created per free-text string (that would pollute the
// account rollups with duplicates). `name` MUST match the opportunity.customer
// string verbatim so the normalizeName join links them. The three
// enrichment-backed names (CI Financial, Rush, Mantu) additionally resolve the
// CompanyEnrichment cache via the same normalizeName key; the rest show base
// Company data only (no Apollo key locally). IDs are stable for idempotent
// re-seeding.
export interface FixtureCompany {
  id: string;
  name: string;
  domain: string;
  industry: string;
  countryCode: string;
  employeeCount: number;
  tier: 'key' | 'standard';
  keyAccountNotes: string | null;
}

export const fixtureCompanies: FixtureCompany[] = [
  {
    id: 'c0000000-0000-4000-8000-000000000001',
    name: 'CI Financial',
    domain: 'ci.com',
    industry: 'financial_services',
    countryCode: 'CA',
    employeeCount: 2500,
    tier: 'key',
    keyAccountNotes: 'Strategic IT modernization + MSP account — exec sponsor engaged.',
  },
  {
    id: 'c0000000-0000-4000-8000-000000000002',
    name: 'Logistec Corporation',
    domain: 'logistec.com',
    industry: 'transportation',
    countryCode: 'CA',
    employeeCount: 1200,
    tier: 'standard',
    keyAccountNotes: null,
  },
  {
    id: 'c0000000-0000-4000-8000-000000000003',
    name: 'Rush University System for Health',
    domain: 'rush.edu',
    industry: 'healthcare',
    countryCode: 'US',
    employeeCount: 14_000,
    tier: 'key',
    keyAccountNotes: 'EHR cloud migration — regulated, high-touch delivery.',
  },
  {
    id: 'c0000000-0000-4000-8000-000000000004',
    name: 'MAPFRE',
    domain: 'mapfre.com',
    industry: 'insurance',
    countryCode: 'ES',
    employeeCount: 30_000,
    tier: 'standard',
    keyAccountNotes: null,
  },
  {
    id: 'c0000000-0000-4000-8000-000000000005',
    name: 'MAHLE',
    domain: 'mahle.com',
    industry: 'manufacturing',
    countryCode: 'DE',
    employeeCount: 72_000,
    tier: 'standard',
    keyAccountNotes: null,
  },
  {
    id: 'c0000000-0000-4000-8000-000000000006',
    name: 'Aritzia',
    domain: 'aritzia.com',
    industry: 'retail',
    countryCode: 'CA',
    employeeCount: 9000,
    tier: 'standard',
    keyAccountNotes: null,
  },
  {
    id: 'c0000000-0000-4000-8000-000000000007',
    name: 'NOS',
    domain: 'nos.pt',
    industry: 'telecom',
    countryCode: 'PT',
    employeeCount: 4000,
    tier: 'standard',
    keyAccountNotes: null,
  },
  {
    id: 'c0000000-0000-4000-8000-000000000008',
    name: 'DNB Bank',
    domain: 'dnb.no',
    industry: 'financial_services',
    countryCode: 'NO',
    employeeCount: 9000,
    tier: 'key',
    keyAccountNotes: 'Cloud landing zone — multi-region rollout.',
  },
  {
    id: 'c0000000-0000-4000-8000-000000000009',
    name: 'Mantu',
    domain: 'mantu.com',
    industry: 'consulting',
    countryCode: 'FR',
    employeeCount: 12_000,
    tier: 'standard',
    keyAccountNotes: null,
  },
];

export interface FixtureContact {
  id: string;
  customer: string;
  name: string;
  role: string;
  email: string;
  phone: string;
  influence: number;
  sentiment: Sentiment;
}

// UUIDs are stable so re-seeding doesn't churn IDs in fixtures consumed by tests.
export const fixtureContacts: FixtureContact[] = [
  {
    id: '00000000-0000-4000-8000-000000000001',
    customer: 'CI Financial',
    name: 'Michael Johnson',
    role: 'Chief Information Officer',
    email: 'mjohnson@ci.com',
    phone: '+1 416 555 0142',
    influence: 5,
    sentiment: Sentiment.warm,
  },
  {
    id: '00000000-0000-4000-8000-000000000002',
    customer: 'CI Financial',
    name: 'Sarah Patel',
    role: 'IT Security Manager',
    email: 'spatel@ci.com',
    phone: '+1 416 555 0119',
    influence: 4,
    sentiment: Sentiment.hot,
  },
  {
    id: '00000000-0000-4000-8000-000000000003',
    customer: 'CI Financial',
    name: 'David Liang',
    role: 'Infrastructure Director',
    email: 'dliang@ci.com',
    phone: '+1 416 555 0173',
    influence: 3,
    sentiment: Sentiment.neutral,
  },
  {
    id: '00000000-0000-4000-8000-000000000004',
    customer: 'Logistec Corporation',
    name: 'Helena Voss',
    role: 'CISO',
    email: 'h.voss@logistec.com',
    phone: '+1 514 555 0167',
    influence: 5,
    sentiment: Sentiment.warm,
  },
  {
    id: '00000000-0000-4000-8000-000000000005',
    customer: 'Rush University System for Health',
    name: 'Anil Rajan',
    role: 'VP Technology',
    email: 'arajan@rush.edu',
    phone: '+1 312 555 0190',
    influence: 5,
    sentiment: Sentiment.hot,
  },
  {
    id: '00000000-0000-4000-8000-000000000006',
    customer: 'MAPFRE',
    name: 'Carmen López',
    role: 'Identity Architect',
    email: 'c.lopez@mapfre.com',
    phone: '+34 91 555 0123',
    influence: 4,
    sentiment: Sentiment.warm,
  },
  {
    id: '00000000-0000-4000-8000-000000000007',
    customer: 'MAHLE',
    name: 'Heinrich Müller',
    role: 'Head of Plant IT',
    email: 'h.mueller@mahle.com',
    phone: '+49 711 555 0145',
    influence: 4,
    sentiment: Sentiment.hot,
  },
  {
    id: '00000000-0000-4000-8000-000000000008',
    customer: 'Aritzia',
    name: 'Olivia Reyes',
    role: 'VP Operations',
    email: 'o.reyes@aritzia.com',
    phone: '+1 604 555 0188',
    influence: 5,
    sentiment: Sentiment.warm,
  },
];

export type { FixtureTask, FixtureLead } from './seed-data.tasks-leads.js';
export { fixtureTasks, intelFor, fixtureLeads } from './seed-data.tasks-leads.js';
