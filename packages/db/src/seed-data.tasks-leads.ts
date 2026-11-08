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

// Opportunity intel stays empty until a real source writes it.
// A shared dossier (65% win prediction, a Series D trigger, Accenture/DXC
// scores, and a copied press headline) used to land on every opportunity.
// That was not a measurement. presentOpportunityIntel still drops any row
// that still carries that dossier.
export function intelFor(_code: string): Record<string, unknown> {
  return {};
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
