/**
 * seed-data.tasks-leads.ts — task, intel, and lead fixtures.
 *
 * Extracted from seed-data.ts (BS-R1 file-size refactor).
 * Re-exported from seed-data.ts — import from there, not here.
 */
import { LeadPriority, LeadStatus, TaskStatus } from '../generated/client/index.js';

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

export interface FixtureLead {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  companyName: string;
  title?: string;
  source: string;
  status: LeadStatus;
  score: number;
  priority: LeadPriority;
  ownerInitials: string;
}

export const fixtureLeads: FixtureLead[] = [
  {
    id: '00000000-0000-4000-8000-000000000101',
    firstName: 'Alex',
    lastName: 'Chen',
    email: 'alex.chen@techflow.io',
    phone: '+1 415 555 0198',
    companyName: 'TechFlow Inc',
    title: 'CTO',
    source: 'website',
    status: LeadStatus.new,
    score: 72,
    priority: LeadPriority.high,
    ownerInitials: 'JS',
  },
  {
    id: '00000000-0000-4000-8000-000000000102',
    firstName: 'Maria',
    lastName: 'Gonzalez',
    email: 'maria.gonzalez@globalhealth.org',
    companyName: 'Global Health Partners',
    title: 'Procurement Director',
    source: 'referral',
    status: LeadStatus.qualified,
    score: 85,
    priority: LeadPriority.critical,
    ownerInitials: 'MT',
  },
  {
    id: '00000000-0000-4000-8000-000000000103',
    firstName: 'James',
    lastName: 'Wilson',
    email: 'j.wilson@finsec.com',
    phone: '+44 20 7946 0958',
    companyName: 'FinSec Solutions',
    title: 'Head of IT',
    source: 'event',
    status: LeadStatus.nurture,
    score: 45,
    priority: LeadPriority.medium,
    ownerInitials: 'SB',
  },
  {
    id: '00000000-0000-4000-8000-000000000104',
    firstName: 'Priya',
    lastName: 'Patel',
    email: 'priya.patel@logistec.ca',
    companyName: 'Logistec Corporation',
    title: 'VP Operations',
    source: 'partner',
    status: LeadStatus.new,
    score: 60,
    priority: LeadPriority.high,
    ownerInitials: 'JS',
  },
];
