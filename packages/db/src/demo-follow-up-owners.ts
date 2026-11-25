/**
 * Follow-ups written into a freshly signed-in demo org.
 *
 * `ME` is the visitor. `seedUsers` stores that person under the same key, and
 * `seedTasks` resolves the assignee through it. Teammate initials stay the
 * coworkers. The Siemens technical volume is the visitor's in-progress bid.
 * The other follow-ups stay with Sofia, Marco, and Priya.
 */
export const DEMO_VISITOR_ASSIGNEE = 'ME';

export type DemoFollowUpStatus = 'open' | 'in_progress' | 'done' | 'blocked';

export interface DemoFollowUp {
  oppCode: string;
  title: string;
  status: DemoFollowUpStatus;
  dueInDays: number;
  assignee: string;
}

export const DEMO_FOLLOW_UPS: readonly DemoFollowUp[] = [
  {
    oppCode: 'OP-0001',
    title: 'Finalize technical volume for Siemens ERP',
    status: 'in_progress',
    dueInDays: 5,
    assignee: DEMO_VISITOR_ASSIGNEE,
  },
  {
    oppCode: 'OP-0002',
    title: 'Prepare pricing annex for IKEA',
    status: 'open',
    dueInDays: 3,
    assignee: 'MB',
  },
  {
    oppCode: 'OP-0003',
    title: 'Schedule discovery workshop with Sanofi CMIO',
    status: 'open',
    dueInDays: 7,
    assignee: 'PN',
  },
  {
    oppCode: 'OP-0004',
    title: 'Security questionnaire response — HSBC',
    status: 'in_progress',
    dueInDays: 4,
    assignee: 'SA',
  },
  {
    oppCode: 'OP-0005',
    title: 'Kickoff handover to delivery — Stellantis',
    status: 'done',
    dueInDays: -2,
    assignee: 'MB',
  },
];
