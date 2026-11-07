// Demo fixtures behind the bid charts (win/loss, sales cycle, bid score radar,
// activity by hour). Pure data so seed-data.bid-charts.test.ts can check it
// without Prisma. Every record is marked demo in its note or metadata.

export const DEMO_NOTE = 'Demo seed record.';

export interface ClosedDealFixture {
  code: string;
  customer: string;
  name: string;
  stage: 'closed_won' | 'closed_lost';
  value: number;
  monthsAgo: number;
  country: string;
}

/** Closed deals across the last ten months for the enrichment-backed accounts. */
export const fixtureClosedDeals: ClosedDealFixture[] = [
  { code: 'OP-H01', customer: 'CI Financial', name: 'CI Financial — Cloud migration phase 1', stage: 'closed_won', value: 880_000, monthsAgo: 9, country: 'CA' },
  { code: 'OP-H02', customer: 'CI Financial', name: 'CI Financial — Data platform pilot', stage: 'closed_won', value: 540_000, monthsAgo: 7, country: 'CA' },
  { code: 'OP-H03', customer: 'CI Financial', name: 'CI Financial — Managed SOC RFP', stage: 'closed_lost', value: 1_200_000, monthsAgo: 6, country: 'CA' },
  { code: 'OP-H04', customer: 'CI Financial', name: 'CI Financial — Endpoint security rollout', stage: 'closed_won', value: 720_000, monthsAgo: 4, country: 'CA' },
  { code: 'OP-H05', customer: 'CI Financial', name: 'CI Financial — Zero Trust expansion', stage: 'closed_won', value: 1_350_000, monthsAgo: 2, country: 'CA' },
  { code: 'OP-H06', customer: 'CI Financial', name: 'CI Financial — Legacy app retirement', stage: 'closed_lost', value: 300_000, monthsAgo: 1, country: 'CA' },
  { code: 'OP-H07', customer: 'Rush University System for Health', name: 'Rush — EHR integration', stage: 'closed_won', value: 2_100_000, monthsAgo: 8, country: 'US' },
  { code: 'OP-H08', customer: 'Rush University System for Health', name: 'Rush — Clinical analytics', stage: 'closed_won', value: 1_450_000, monthsAgo: 3, country: 'US' },
  { code: 'OP-H09', customer: 'Mantu', name: 'Mantu — Internal tooling refresh', stage: 'closed_won', value: 410_000, monthsAgo: 5, country: 'FR' },
  { code: 'OP-H10', customer: 'Mantu', name: 'Mantu — Workspace consolidation', stage: 'closed_lost', value: 260_000, monthsAgo: 2, country: 'FR' },
];

export interface WinLossFixture {
  code: string;
  outcome: 'won' | 'lost';
  reason: 'price' | 'product_fit' | 'timing' | 'competitor' | 'relationship' | 'scope' | 'no_decision' | 'other';
  competitor: string | null;
  /** Days from opening the bid to its outcome; the seed backdates the opportunity. */
  cycleDays: number;
}

/** One outcome per closed deal; two cycles run past the 90-day mark. */
export const demoWinLoss: WinLossFixture[] = [
  { code: 'OP-H01', outcome: 'won', reason: 'relationship', competitor: null, cycleDays: 74 },
  { code: 'OP-H02', outcome: 'won', reason: 'product_fit', competitor: null, cycleDays: 41 },
  { code: 'OP-H03', outcome: 'lost', reason: 'price', competitor: 'Accenture', cycleDays: 128 },
  { code: 'OP-H04', outcome: 'won', reason: 'timing', competitor: null, cycleDays: 56 },
  { code: 'OP-H05', outcome: 'won', reason: 'relationship', competitor: 'Deloitte', cycleDays: 88 },
  { code: 'OP-H06', outcome: 'lost', reason: 'no_decision', competitor: null, cycleDays: 33 },
  { code: 'OP-H07', outcome: 'won', reason: 'product_fit', competitor: 'Capgemini', cycleDays: 112 },
  { code: 'OP-H08', outcome: 'won', reason: 'scope', competitor: null, cycleDays: 63 },
  { code: 'OP-H09', outcome: 'won', reason: 'relationship', competitor: null, cycleDays: 27 },
  { code: 'OP-H10', outcome: 'lost', reason: 'competitor', competitor: 'Sopra Steria', cycleDays: 49 },
];

/** A partly rated bid/no-bid matrix for the DNB Bank landing zone (OP-2048). */
export const demoBidScore = {
  id: '5eed0002-0000-4000-8000-000000002048',
  oppCode: 'OP-2048',
  criteria: {
    strategic_fit: 4,
    relationship: 3,
    competitive: 3,
    tech_capability: 4,
    resource_avail: 3,
    solution_ready: 4,
    deal_size: 5,
    payment_terms: 3,
    financial_risk: 3,
    timeline_risk: 2,
  } as Record<string, number>,
};

export interface ActivityFixture {
  id: string;
  oppCode: string;
  type: 'call' | 'email' | 'meeting' | 'note';
  subject: string;
  daysAgo: number;
  /** Hour of day in UTC. */
  hour: number;
  minute: number;
}

const ACTIVITY_PLAN: Array<Omit<ActivityFixture, 'id'>> = [
  { oppCode: 'OP-2048', type: 'meeting', subject: 'Landing zone scoping workshop', daysAgo: 1, hour: 13, minute: 0 },
  { oppCode: 'OP-2048', type: 'email', subject: 'Follow-up on network topology', daysAgo: 1, hour: 15, minute: 20 },
  { oppCode: 'OP-2048', type: 'call', subject: 'Procurement timeline check', daysAgo: 3, hour: 9, minute: 30 },
  { oppCode: 'OP-2041', type: 'call', subject: 'Exec sponsor catch-up', daysAgo: 2, hour: 14, minute: 0 },
  { oppCode: 'OP-2041', type: 'email', subject: 'MSP pricing options', daysAgo: 2, hour: 16, minute: 10 },
  { oppCode: 'OP-2041', type: 'meeting', subject: 'Architecture review', daysAgo: 6, hour: 15, minute: 0 },
  { oppCode: 'OP-2042', type: 'email', subject: 'SOC 2 readiness questionnaire', daysAgo: 4, hour: 12, minute: 45 },
  { oppCode: 'OP-2042', type: 'call', subject: 'Auditor introduction', daysAgo: 5, hour: 17, minute: 15 },
  { oppCode: 'OP-2043', type: 'meeting', subject: 'EHR migration steering', daysAgo: 3, hour: 18, minute: 0 },
  { oppCode: 'OP-2043', type: 'note', subject: 'Clinical sign-off needed before cutover', daysAgo: 3, hour: 19, minute: 5 },
  { oppCode: 'OP-2043', type: 'email', subject: 'Cutover window proposal', daysAgo: 7, hour: 14, minute: 30 },
  { oppCode: 'OP-2044', type: 'call', subject: 'IAM scope call', daysAgo: 8, hour: 10, minute: 0 },
  { oppCode: 'OP-2044', type: 'email', subject: 'Identity provider comparison', daysAgo: 8, hour: 11, minute: 40 },
  { oppCode: 'OP-2045', type: 'meeting', subject: 'OT/IT plant visit debrief', daysAgo: 9, hour: 8, minute: 30 },
  { oppCode: 'OP-2045', type: 'email', subject: 'Plant network diagrams', daysAgo: 10, hour: 13, minute: 15 },
  { oppCode: 'OP-2046', type: 'call', subject: 'Endpoint refresh volumes', daysAgo: 11, hour: 16, minute: 45 },
  { oppCode: 'OP-2046', type: 'note', subject: 'Prefers phased rollout by store region', daysAgo: 11, hour: 17, minute: 30 },
  { oppCode: 'OP-2047', type: 'email', subject: 'SOC build-out proposal sent', daysAgo: 12, hour: 9, minute: 10 },
  { oppCode: 'OP-2047', type: 'call', subject: 'Proposal walkthrough', daysAgo: 12, hour: 14, minute: 20 },
  { oppCode: 'OP-2047', type: 'meeting', subject: 'Security lead workshop', daysAgo: 13, hour: 10, minute: 30 },
];

/** Stable ids so re-seeding upserts instead of duplicating. */
export const demoActivities: ActivityFixture[] = ACTIVITY_PLAN.map((a, i) => ({
  ...a,
  id: `5eed0003-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
}));
