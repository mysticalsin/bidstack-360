/**
 * Capture filing: decide which contact, account and opportunity an email or
 * meeting belongs to, from its participants.
 *
 * 1. Drop the mailbox owner and colleagues on the owner's domain.
 * 2. A participant that is a known contact wins; its account comes with it.
 * 3. Otherwise the first participant domain that matches an account's
 *    domain (free mail domains never match).
 * 4. The opportunity is filled only when the account has exactly one open
 *    bid, so a thread is never filed on the wrong deal.
 *
 * Three bounded queries per item at most; no per-participant lookups.
 */
import { prisma } from '@bidstack/db';

const FREE_MAIL = new Set([
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'msn.com',
  'yahoo.com',
  'icloud.com',
  'me.com',
  'aol.com',
  'proton.me',
  'protonmail.com',
  'gmx.com',
]);

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_PARTICIPANTS = 50;

/** Where a captured item is filed. */
export interface CaptureTarget {
  entityType: 'contact' | 'company';
  entityId: string;
  contactId: string | null;
  companyId: string | null;
  opportunityId: string | null;
}

/** The prisma surface this module reads; injectable for tests. */
export interface CaptureDb {
  contact: {
    findMany(args: {
      where: { orgId: string; deletedAt: null; email: { in: string[] } };
      select: { id: true; email: true; companyId: true };
      take: number;
    }): Promise<Array<{ id: string; email: string | null; companyId: string | null }>>;
  };
  company: {
    findFirst(args: {
      where: { orgId: string; deletedAt: null; OR: Array<{ domain: { in: string[]; mode: 'insensitive' } }> };
      select: { id: true; domain: true };
    }): Promise<{ id: string; domain: string | null } | null>;
  };
  opportunity: {
    findMany(args: {
      where: {
        orgId: string;
        companyId: string;
        deletedAt: null;
        stage: { notIn: Array<'closed_won' | 'closed_lost'> };
      };
      select: { id: true };
      orderBy: { updatedAt: 'desc' };
      take: number;
    }): Promise<Array<{ id: string }>>;
  };
}

function domainOf(email: string): string {
  return email.slice(email.lastIndexOf('@') + 1).toLowerCase();
}

/** Lower-cased external participants: no owner, no same-domain colleagues. */
export function externalParticipants(ownerEmail: string | null, participants: readonly string[]): string[] {
  const owner = ownerEmail?.trim().toLowerCase() ?? '';
  const ownerDomain = owner.includes('@') ? domainOf(owner) : '';
  const out: string[] = [];
  for (const raw of participants) {
    const email = raw.trim().toLowerCase();
    if (!EMAIL.test(email) || email === owner) continue;
    if (ownerDomain && domainOf(email) === ownerDomain) continue;
    if (!out.includes(email)) out.push(email);
    if (out.length >= MAX_PARTICIPANTS) break;
  }
  return out;
}

/** Candidate account domains for a participant domain (mail.acme.com -> acme.com). */
function candidateDomains(emails: string[]): string[] {
  const out = new Set<string>();
  for (const email of emails) {
    const d = domainOf(email);
    if (FREE_MAIL.has(d)) continue;
    out.add(d);
    const labels = d.split('.');
    if (labels.length > 2) out.add(labels.slice(-2).join('.'));
  }
  return [...out];
}

async function singleOpenOpportunity(db: CaptureDb, orgId: string, companyId: string): Promise<string | null> {
  const open = await db.opportunity.findMany({
    where: { orgId, companyId, deletedAt: null, stage: { notIn: ['closed_won', 'closed_lost'] } },
    select: { id: true },
    orderBy: { updatedAt: 'desc' },
    take: 2,
  });
  return open.length === 1 ? (open[0]?.id ?? null) : null;
}

/** Resolve the filing target for one captured email or meeting. */
export async function resolveCaptureTarget(
  input: { orgId: string; ownerEmail: string | null; participants: readonly string[] },
  db: CaptureDb = prisma as unknown as CaptureDb,
): Promise<CaptureTarget | null> {
  const externals = externalParticipants(input.ownerEmail, input.participants);
  if (externals.length === 0) return null;

  const contacts = await db.contact.findMany({
    where: { orgId: input.orgId, deletedAt: null, email: { in: externals } },
    select: { id: true, email: true, companyId: true },
    take: MAX_PARTICIPANTS,
  });
  const rank = (email: string | null) => externals.indexOf((email ?? '').toLowerCase());
  const contact = [...contacts].sort((a, b) => rank(a.email) - rank(b.email))[0];

  if (contact) {
    const companyId = contact.companyId ?? null;
    return {
      entityType: 'contact',
      entityId: contact.id,
      contactId: contact.id,
      companyId,
      opportunityId: companyId ? await singleOpenOpportunity(db, input.orgId, companyId) : null,
    };
  }

  const domains = candidateDomains(externals);
  if (domains.length === 0) return null;
  const company = await db.company.findFirst({
    where: { orgId: input.orgId, deletedAt: null, OR: [{ domain: { in: domains, mode: 'insensitive' } }] },
    select: { id: true, domain: true },
  });
  if (!company) return null;
  return {
    entityType: 'company',
    entityId: company.id,
    contactId: null,
    companyId: company.id,
    opportunityId: await singleOpenOpportunity(db, input.orgId, company.id),
  };
}

/** Prisma data fields for a capture target (all null when unfiled). */
export function captureColumns(target: CaptureTarget | null) {
  return {
    contactId: target?.contactId ?? null,
    companyId: target?.companyId ?? null,
    opportunityId: target?.opportunityId ?? null,
  };
}

/** Every column a calendar pull files an event with. */
export function calendarFiling(target: CaptureTarget | null) {
  return {
    relatedEntityType: target?.entityType ?? null,
    relatedEntityId: target?.entityId ?? null,
    ...captureColumns(target),
  };
}

/**
 * Refile an existing calendar event from its participants, unless a user
 * filed it by hand (calendar PATCH/POST). The guard is in the same statement
 * so a concurrent manual filing is never overwritten.
 */
export async function refileUnlessManual(
  key: { orgId: string; ownerId: string; provider: 'google_workspace' | 'microsoft_graph'; externalId: string },
  filing: ReturnType<typeof calendarFiling>,
): Promise<void> {
  await prisma.calendarEvent.updateMany({
    where: { ...key, filedManually: false },
    data: filing,
  });
}
