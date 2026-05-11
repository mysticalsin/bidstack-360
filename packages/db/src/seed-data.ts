// Fixtures distilled from the prototype's `src/data.js`.
// Stage names are normalized to the canonical enum.

import { OpportunityStage, Sentiment, TaskStatus } from '../generated/client/index.js';

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
}

export const fixtureOpps: FixtureOpp[] = [
  {
    code: 'OP-2041',
    customer: 'CI Financial',
    name: 'CI Financial — IT Modernization & MSP',
    stage: OpportunityStage.proposal,
    value: 1_240_000,
    probability: 65,
    dueDate: '2026-07-22',
    ownerInitials: 'JS',
    industry: 'financial_services',
    logoUrl: null,
  },
  {
    code: 'OP-2042',
    customer: 'Logistec Corporation',
    name: 'Logistec Corporation — SOC 2 Readiness',
    stage: OpportunityStage.discovery,
    value: 320_000,
    probability: 35,
    dueDate: '2026-08-15',
    ownerInitials: 'MT',
    industry: 'transportation',
    logoUrl: null,
  },
  {
    code: 'OP-2043',
    customer: 'Rush University System for Health',
    name: 'Rush University — EHR Cloud Migration',
    stage: OpportunityStage.negotiation,
    value: 4_800_000,
    probability: 78,
    dueDate: '2026-06-30',
    ownerInitials: 'JS',
    industry: 'healthcare',
    logoUrl: null,
  },
  {
    code: 'OP-2044',
    customer: 'MAPFRE',
    name: 'MAPFRE — Identity & Access Overhaul',
    stage: OpportunityStage.qualified, // prototype: "qualifying"
    value: 680_000,
    probability: 20,
    dueDate: '2026-09-30',
    ownerInitials: 'SB',
    industry: 'insurance',
    logoUrl: null,
  },
  {
    code: 'OP-2045',
    customer: 'MAHLE',
    name: 'MAHLE — OT/IT Convergence',
    stage: OpportunityStage.proposal,
    value: 2_150_000,
    probability: 55,
    dueDate: '2026-08-01',
    ownerInitials: 'DL',
    industry: 'manufacturing',
    logoUrl: null,
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
  },
  {
    code: 'OP-2048',
    customer: 'DNB Bank',
    name: 'DNB Bank — Cloud landing zone',
    stage: OpportunityStage.discovery,
    value: 2_700_000,
    probability: 40,
    dueDate: '2026-09-15',
    ownerInitials: 'JS',
    industry: 'financial_services',
    logoUrl: null,
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

export interface FixtureTask {
  id: string;
  oppCode: string;
  title: string;
  dueDate: string | null;
  status: TaskStatus;
  assigneeInitials: string;
}

export const fixtureTasks: FixtureTask[] = [
  {
    id: '00000000-0000-4000-8000-000000010001',
    oppCode: 'OP-2041',
    title: 'Submit revised pricing & SoW v2',
    dueDate: '2026-05-15',
    status: TaskStatus.in_progress,
    assigneeInitials: 'JS',
  },
  {
    id: '00000000-0000-4000-8000-000000010002',
    oppCode: 'OP-2042',
    title: 'Workshop with Logistec CISO',
    dueDate: '2026-05-20',
    status: TaskStatus.open,
    assigneeInitials: 'MT',
  },
  {
    id: '00000000-0000-4000-8000-000000010003',
    oppCode: 'OP-2043',
    title: 'Final commercial review — Rush University',
    dueDate: '2026-05-12',
    status: TaskStatus.in_progress,
    assigneeInitials: 'JS',
  },
  {
    id: '00000000-0000-4000-8000-000000010004',
    oppCode: 'OP-2045',
    title: 'On-site assessment MAHLE Plant 4',
    dueDate: '2026-05-21',
    status: TaskStatus.open,
    assigneeInitials: 'DL',
  },
  {
    id: '00000000-0000-4000-8000-000000010005',
    oppCode: 'OP-2044',
    title: 'Confirm MAPFRE budget owner',
    dueDate: '2026-05-23',
    status: TaskStatus.open,
    assigneeInitials: 'SB',
  },
  {
    id: '00000000-0000-4000-8000-000000010006',
    oppCode: 'OP-2046',
    title: 'Schedule Aritzia kickoff',
    dueDate: '2026-05-12',
    status: TaskStatus.open,
    assigneeInitials: 'MT',
  },
  {
    id: '00000000-0000-4000-8000-000000010007',
    oppCode: 'OP-2048',
    title: 'Architecture workshop — DNB',
    dueDate: '2026-05-19',
    status: TaskStatus.open,
    assigneeInitials: 'JS',
  },
];

// Returns an intel JSONB payload for a given opportunity code.
// Models the prototype's intel-data.js shape (financials, triggers, decision
// unit, competitors, news, hiring, win prediction). For fixtures, all opps
// get a representative payload; Dust enrichment will replace it in production.
export function intelFor(code: string): Record<string, unknown> {
  const refreshedAt = new Date('2026-05-10T08:00:00Z').toISOString();
  return {
    refreshedAt,
    financial: {
      ticker: code === 'OP-2041' ? 'CIX.TO' : null,
      marketCap: code === 'OP-2041' ? 4_800_000_000 : null,
      revenueAnnual: code === 'OP-2041' ? 1_200_000_000 : null,
      revenueGrowth: 0.06,
      ebitdaMargin: 0.32,
      creditRating: code === 'OP-2041' ? 'A-' : null,
      headcount: 2500,
      headcountTrend: [
        { date: '2025-Q3', n: 2400 },
        { date: '2025-Q4', n: 2440 },
        { date: '2026-Q1', n: 2500 },
      ],
      pricePoints: Array.from({ length: 30 }, (_, i) => 100 + Math.sin(i / 3) * 6),
    },
    triggers: [
      {
        id: `${code}-t1`,
        kind: 'funding',
        label: 'Closed Series D — $80M',
        weight: 8,
        observedAt: '2026-04-15T00:00:00Z',
        source: 'Crunchbase',
      },
      {
        id: `${code}-t2`,
        kind: 'executive_move',
        label: 'New CTO appointed',
        weight: 7,
        observedAt: '2026-03-20T00:00:00Z',
        source: 'LinkedIn',
      },
      {
        id: `${code}-t3`,
        kind: 'regulatory',
        label: 'NIS2 deadline approaching',
        weight: 6,
        observedAt: '2026-05-01T00:00:00Z',
        source: 'EU register',
      },
    ],
    decisionUnit: [],
    competitors: [
      { vendor: 'Accenture', score: 72, strengths: ['Scale', 'Brand'], weaknesses: ['Cost'] },
      { vendor: 'DXC', score: 64, strengths: ['Local presence'], weaknesses: ['Tech depth'] },
    ],
    news: [
      {
        id: `${code}-n1`,
        headline: 'Customer announces digital transformation roadmap',
        source: 'Press release',
        publishedAt: '2026-04-22T00:00:00Z',
        sentiment: 'positive',
        url: null,
      },
    ],
    hiring: {
      openings: [
        {
          title: 'VP Cloud Engineering',
          department: 'IT',
          urgency: 'high',
          postedAt: '2026-05-01T00:00:00Z',
        },
      ],
      velocity: 1.2,
      trendDirection: 'up',
    },
    winPrediction: {
      probability: 65,
      modelVersion: 'wp-baseline-0.1',
      drivers: [
        { label: 'Champion strength', contribution: 18 },
        { label: 'Pricing competitiveness', contribution: 15 },
        { label: 'Recent funding', contribution: 9 },
        { label: 'Incumbent risk', contribution: -12 },
        { label: 'Long deal cycle', contribution: -8 },
      ],
    },
  };
}
