/**
 * seed-org-data.ts — curated, multi-tenant demo dataset.
 *
 * Populates ONE org with a compact, realistic Mantu bid/presales workspace:
 * teammates, opportunities, contacts, leads, tasks, and a spread of proposals
 * across every status (so RFP Analytics, the pipeline, and the lead Kanban all
 * look alive). Unlike `src/seed.ts` (which targets the single dev
 * `org_seed_mantu` fixture and bulk-upserts), this is parameterized by `orgId`,
 * generates fresh UUIDs, and namespaces globally-unique fields — so it is safe
 * to call once per visitor org at runtime (the demo sign-in door) as well as
 * from the `db:seed:demo` CLI.
 *
 * The org it populates contains ONLY what this function creates. That is the
 * guarantee behind "demo accounts are never full of test/ops junk."
 */
import type { PrismaClient } from '../generated/client/index.js';

import { seedRolesAndPermissions } from './seed.rbac.js';

export interface SeedOrgDataOptions {
  /** The visitor's email — becomes the org's admin user (shown in the UI). */
  ownerEmail: string;
  /** Display name for the visitor; defaults to a friendly placeholder. */
  ownerName?: string;
  /**
   * Short token that namespaces globally-unique teammate emails + clerkUser ids
   * so two demo orgs never collide on the User.email / clerkUser unique indexes.
   * Use something stable per org (e.g. a slug derived from the orgId).
   */
  namespace: string;
}

// ── Curated dataset (compact + realistic; an enterprise IT-services bid desk) ──

interface TeammateSpec {
  initials: string;
  name: string;
  emailLocal: string;
  role: string; // User.role string
  roleName: string; // seeded Role to grant for permissions
}

const TEAMMATES: TeammateSpec[] = [
  {
    initials: 'SA',
    name: 'Sofia Almeida',
    emailLocal: 'sofia.almeida',
    role: 'manager',
    roleName: 'Manager',
  },
  {
    initials: 'MB',
    name: 'Marco Bianchi',
    emailLocal: 'marco.bianchi',
    role: 'member',
    roleName: 'Presales',
  },
  {
    initials: 'PN',
    name: 'Priya Nair',
    emailLocal: 'priya.nair',
    role: 'member',
    roleName: 'Sales',
  },
];

type OppStage =
  | 's1_lead'
  | 's1_ongoing'
  | 's2_sent'
  | 's3_technical_iteration'
  | 's4_negotiation'
  | 'closed_won'
  | 'closed_lost';

interface OppSpec {
  code: string;
  customer: string;
  name: string;
  stage: OppStage;
  value: number;
  owner: string;
  industry: string;
  country: string;
  probability: number;
}

const OPPS: OppSpec[] = [
  {
    code: 'ACME-26-001',
    customer: 'Acme Manufacturing',
    name: 'Global ERP Modernization',
    stage: 's3_technical_iteration',
    value: 1_200_000,
    owner: 'SA',
    industry: 'Manufacturing',
    country: 'DE',
    probability: 60,
  },
  {
    code: 'NORD-26-002',
    customer: 'Nordic Retail Group',
    name: 'Cloud Migration & FinOps',
    stage: 's4_negotiation',
    value: 850_000,
    owner: 'MB',
    industry: 'Retail',
    country: 'SE',
    probability: 75,
  },
  {
    code: 'MEDL-26-003',
    customer: 'Medline Health',
    name: 'Patient Data Platform',
    stage: 's2_sent',
    value: 2_400_000,
    owner: 'PN',
    industry: 'Healthcare',
    country: 'FR',
    probability: 40,
  },
  {
    code: 'LUMN-26-004',
    customer: 'Lumen Financial',
    name: 'Cybersecurity Transformation',
    stage: 's1_ongoing',
    value: 1_750_000,
    owner: 'SA',
    industry: 'Financial Services',
    country: 'GB',
    probability: 25,
  },
  {
    code: 'VOLT-26-005',
    customer: 'Voltaic Mobility',
    name: 'EV Fleet Telematics',
    stage: 'closed_won',
    value: 620_000,
    owner: 'MB',
    industry: 'Automotive',
    country: 'IT',
    probability: 100,
  },
  {
    code: 'ORBT-26-006',
    customer: 'Orbit Media',
    name: 'Data Lakehouse Build',
    stage: 'closed_lost',
    value: 430_000,
    owner: 'PN',
    industry: 'Media',
    country: 'ES',
    probability: 0,
  },
];

type ProposalStatus = 'draft' | 'review' | 'approved' | 'submitted' | 'won' | 'lost';

interface PropSpec {
  oppCode: string;
  name: string;
  status: ProposalStatus;
  owner: string;
  complianceScore: number | null;
  approved?: boolean;
}

// Spread across every status so RFP Analytics shows a real win rate + by-status +
// by-owner breakdown rather than an empty rollup.
const PROPOSALS: PropSpec[] = [
  {
    oppCode: 'ACME-26-001',
    name: 'Acme ERP — Technical Proposal',
    status: 'review',
    owner: 'SA',
    complianceScore: 82,
  },
  {
    oppCode: 'ACME-26-001',
    name: 'Acme ERP — Executive Summary',
    status: 'draft',
    owner: 'SA',
    complianceScore: null,
  },
  {
    oppCode: 'NORD-26-002',
    name: 'Nordic Cloud Migration — Final Bid',
    status: 'approved',
    owner: 'MB',
    complianceScore: 94,
    approved: true,
  },
  {
    oppCode: 'MEDL-26-003',
    name: 'Medline Patient Platform — Draft',
    status: 'draft',
    owner: 'PN',
    complianceScore: null,
  },
  {
    oppCode: 'LUMN-26-004',
    name: 'Lumen Cyber — Discovery Response',
    status: 'submitted',
    owner: 'SA',
    complianceScore: 70,
  },
  {
    oppCode: 'VOLT-26-005',
    name: 'Voltaic Telematics — Winning Bid',
    status: 'won',
    owner: 'MB',
    complianceScore: 91,
    approved: true,
  },
  {
    oppCode: 'ORBT-26-006',
    name: 'Orbit Lakehouse — Submitted Bid',
    status: 'lost',
    owner: 'PN',
    complianceScore: 64,
  },
];

type ContactSentiment = 'hot' | 'warm' | 'neutral' | 'cold';

interface ContactSpec {
  customer: string;
  name: string;
  role: string;
  emailLocal: string;
  phone: string;
  influence: number;
  sentiment: ContactSentiment;
}

const CONTACTS: ContactSpec[] = [
  {
    customer: 'Acme Manufacturing',
    name: 'Klaus Vogt',
    role: 'VP Operations',
    emailLocal: 'klaus.vogt',
    phone: '+49 30 1234 5670',
    influence: 90,
    sentiment: 'hot',
  },
  {
    customer: 'Acme Manufacturing',
    name: 'Lena Fischer',
    role: 'IT Director',
    emailLocal: 'lena.fischer',
    phone: '+49 30 1234 5671',
    influence: 70,
    sentiment: 'warm',
  },
  {
    customer: 'Nordic Retail Group',
    name: 'Erik Lindqvist',
    role: 'CFO',
    emailLocal: 'erik.lindqvist',
    phone: '+46 8 555 0102',
    influence: 85,
    sentiment: 'warm',
  },
  {
    customer: 'Medline Health',
    name: 'Camille Rousseau',
    role: 'Chief Medical Information Officer',
    emailLocal: 'camille.rousseau',
    phone: '+33 1 4455 6677',
    influence: 95,
    sentiment: 'hot',
  },
  {
    customer: 'Lumen Financial',
    name: 'James Whitfield',
    role: 'CISO',
    emailLocal: 'james.whitfield',
    phone: '+44 20 7946 0102',
    influence: 80,
    sentiment: 'neutral',
  },
  {
    customer: 'Voltaic Mobility',
    name: 'Giulia Ferrari',
    role: 'Head of Digital',
    emailLocal: 'giulia.ferrari',
    phone: '+39 02 1234 567',
    influence: 88,
    sentiment: 'hot',
  },
];

type LeadStatusLit = 'new' | 'contacted' | 'qualified' | 'nurture';
type LeadPriorityLit = 'low' | 'medium' | 'high' | 'critical';

interface LeadSpec {
  firstName: string;
  lastName: string;
  companyName: string;
  title: string;
  source: string;
  status: LeadStatusLit;
  score: number;
  priority: LeadPriorityLit;
  owner: string;
}

const LEADS: LeadSpec[] = [
  {
    firstName: 'Hannah',
    lastName: 'Berg',
    companyName: 'Vestra Logistics',
    title: 'Head of Procurement',
    source: 'event',
    status: 'qualified',
    score: 78,
    priority: 'high',
    owner: 'SA',
  },
  {
    firstName: 'Tom',
    lastName: 'Almeida',
    companyName: 'Brightwave Energy',
    title: 'COO',
    source: 'referral',
    status: 'contacted',
    score: 64,
    priority: 'medium',
    owner: 'MB',
  },
  {
    firstName: 'Sara',
    lastName: 'Nkomo',
    companyName: 'Cape Health Networks',
    title: 'CIO',
    source: 'website',
    status: 'new',
    score: 50,
    priority: 'medium',
    owner: 'PN',
  },
  {
    firstName: 'Daniel',
    lastName: 'Korhonen',
    companyName: 'Polar Foods',
    title: 'VP IT',
    source: 'cold_outreach',
    status: 'nurture',
    score: 42,
    priority: 'low',
    owner: 'SA',
  },
  {
    firstName: 'Aisha',
    lastName: 'Rahman',
    companyName: 'Crescent Bank',
    title: 'Head of Transformation',
    source: 'partner',
    status: 'qualified',
    score: 81,
    priority: 'critical',
    owner: 'MB',
  },
];

type TaskStatusLit = 'open' | 'in_progress' | 'done' | 'blocked';

interface TaskSpec {
  oppCode: string;
  title: string;
  status: TaskStatusLit;
  dueInDays: number;
  assignee: string;
}

const TASKS: TaskSpec[] = [
  {
    oppCode: 'ACME-26-001',
    title: 'Finalize technical volume for Acme ERP',
    status: 'in_progress',
    dueInDays: 5,
    assignee: 'SA',
  },
  {
    oppCode: 'NORD-26-002',
    title: 'Prepare pricing annex for Nordic',
    status: 'open',
    dueInDays: 3,
    assignee: 'MB',
  },
  {
    oppCode: 'MEDL-26-003',
    title: 'Schedule discovery workshop with Medline CMIO',
    status: 'open',
    dueInDays: 7,
    assignee: 'PN',
  },
  {
    oppCode: 'LUMN-26-004',
    title: 'Security questionnaire response — Lumen',
    status: 'in_progress',
    dueInDays: 4,
    assignee: 'SA',
  },
  {
    oppCode: 'VOLT-26-005',
    title: 'Kickoff handover to delivery — Voltaic',
    status: 'done',
    dueInDays: -2,
    assignee: 'MB',
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function eur(value: number): bigint {
  return BigInt(Math.round(value * 1_000_000));
}

function daysFromNow(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d;
}

/** Grant a seeded org Role to a user (mirrors auth-helpers.ensureAdminRoleGrant). */
async function grantRole(
  prisma: PrismaClient,
  orgId: string,
  userId: string,
  roleName: string,
): Promise<void> {
  const role = await prisma.role.findFirst({
    where: { orgId, name: roleName, isSystem: true, deletedAt: null },
    select: { id: true },
  });
  if (!role) return;
  await prisma.userRole.upsert({
    where: { userId_roleId: { userId, roleId: role.id } },
    create: { orgId, userId, roleId: role.id },
    update: { deletedAt: null },
  });
}

interface SeededUsers {
  byInitials: Map<string, string>;
  visitorId: string;
}

async function seedUsers(
  prisma: PrismaClient,
  orgId: string,
  opts: SeedOrgDataOptions,
): Promise<SeededUsers> {
  const ns = opts.namespace;
  const byInitials = new Map<string, string>();

  const visitor = await prisma.user.create({
    data: {
      orgId,
      clerkUser: `demo_${ns}_owner`,
      email: opts.ownerEmail,
      name: opts.ownerName ?? 'Demo User',
      role: 'admin',
    },
  });
  byInitials.set('ME', visitor.id);

  for (const t of TEAMMATES) {
    const u = await prisma.user.create({
      data: {
        orgId,
        clerkUser: `demo_${ns}_${t.initials.toLowerCase()}`,
        email: `${t.emailLocal}.${ns}@bidstack-demo.dev`,
        name: t.name,
        role: t.role,
      },
    });
    byInitials.set(t.initials, u.id);
  }

  return { byInitials, visitorId: visitor.id };
}

async function seedOpps(
  prisma: PrismaClient,
  orgId: string,
  byInitials: Map<string, string>,
): Promise<Map<string, string>> {
  const oppByCode = new Map<string, string>();
  for (const o of OPPS) {
    const opp = await prisma.opportunity.create({
      data: {
        orgId,
        code: o.code,
        customer: o.customer,
        name: o.name,
        stage: o.stage,
        valueMicros: eur(o.value),
        probability: o.probability,
        dueDate: daysFromNow(45),
        ownerId: byInitials.get(o.owner) ?? null,
        industry: o.industry,
        country: o.country,
      },
    });
    oppByCode.set(o.code, opp.id);
  }
  return oppByCode;
}

async function seedProposals(
  prisma: PrismaClient,
  orgId: string,
  byInitials: Map<string, string>,
  oppByCode: Map<string, string>,
  visitorId: string,
): Promise<void> {
  for (const p of PROPOSALS) {
    await prisma.proposal.create({
      data: {
        orgId,
        opportunityId: oppByCode.get(p.oppCode) ?? null,
        name: p.name,
        status: p.status,
        ownerId: byInitials.get(p.owner) ?? null,
        complianceScore: p.complianceScore,
        humanReviewRequired: true,
        approvedAt: p.approved ? new Date() : null,
        approvedByUserId: p.approved ? visitorId : null,
        dueDate: daysFromNow(30),
      },
    });
  }
}

async function seedContacts(prisma: PrismaClient, orgId: string, ns: string): Promise<void> {
  for (const c of CONTACTS) {
    await prisma.contact.create({
      data: {
        orgId,
        customer: c.customer,
        name: c.name,
        role: c.role,
        email: `${c.emailLocal}.${ns}@example.com`,
        phone: c.phone,
        influence: c.influence,
        sentiment: c.sentiment,
      },
    });
  }
}

async function seedLeads(
  prisma: PrismaClient,
  orgId: string,
  byInitials: Map<string, string>,
  ns: string,
): Promise<void> {
  for (const l of LEADS) {
    await prisma.lead.create({
      data: {
        orgId,
        firstName: l.firstName,
        lastName: l.lastName,
        companyName: l.companyName,
        title: l.title,
        source: l.source,
        status: l.status,
        score: l.score,
        priority: l.priority,
        ownerId: byInitials.get(l.owner) ?? null,
        email: `${l.firstName}.${l.lastName}.${ns}@example.com`.toLowerCase(),
      },
    });
  }
}

async function seedTasks(
  prisma: PrismaClient,
  orgId: string,
  byInitials: Map<string, string>,
  oppByCode: Map<string, string>,
): Promise<void> {
  for (const t of TASKS) {
    await prisma.task.create({
      data: {
        orgId,
        oppId: oppByCode.get(t.oppCode) ?? null,
        title: t.title,
        status: t.status,
        dueDate: daysFromNow(t.dueInDays),
        assigneeId: byInitials.get(t.assignee) ?? null,
      },
    });
  }
}

/**
 * Populate `orgId` with the curated demo dataset. Assumes a freshly-created org
 * whose `ownerEmail` is not already taken (the demo sign-in door guarantees this
 * by reusing the existing org when an email signs in again).
 */
export async function seedOrgData(
  prisma: PrismaClient,
  orgId: string,
  opts: SeedOrgDataOptions,
): Promise<void> {
  const { byInitials, visitorId } = await seedUsers(prisma, orgId, opts);

  // Create the org's Roles + Permissions (empty map → no fixture-user grants),
  // then grant our demo users explicitly so permission gates resolve.
  await seedRolesAndPermissions(prisma, orgId, new Map());
  await grantRole(prisma, orgId, visitorId, 'Admin');
  for (const t of TEAMMATES) {
    const id = byInitials.get(t.initials);
    if (id) await grantRole(prisma, orgId, id, t.roleName);
  }

  const oppByCode = await seedOpps(prisma, orgId, byInitials);
  await seedProposals(prisma, orgId, byInitials, oppByCode, visitorId);
  await seedContacts(prisma, orgId, opts.namespace);
  await seedLeads(prisma, orgId, byInitials, opts.namespace);
  await seedTasks(prisma, orgId, byInitials, oppByCode);
}
