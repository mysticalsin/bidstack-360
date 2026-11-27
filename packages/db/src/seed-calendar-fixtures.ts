import type { Prisma, PrismaClient } from '../generated/client/index.js';

import { FIXTURE_CALENDAR_EVENTS } from '@bidstack/shared';

type SeedClient = Prisma.TransactionClient | PrismaClient;

export interface FixtureCalendarLink {
  companyName: string;
  oppCode: string | null;
  subject: string;
}

/** Fixture workspace (`pnpm db:seed`) accounts. */
export const FIXTURE_CALENDAR_LINKS: Readonly<Record<string, FixtureCalendarLink>> = {
  'fixture:cal:architecture': {
    companyName: 'CI Financial',
    oppCode: 'OP-2041',
    subject: 'CI Financial — Architecture review',
  },
  'fixture:cal:workshop': {
    companyName: 'DNB Bank',
    oppCode: 'OP-2048',
    subject: 'DNB Bank — Landing zone workshop',
  },
  'fixture:cal:steering': {
    companyName: 'Rush University System for Health',
    oppCode: 'OP-2043',
    subject: 'Rush University — EHR steering',
  },
  'fixture:cal:identity': {
    companyName: 'MAPFRE',
    oppCode: 'OP-2044',
    subject: 'MAPFRE — Identity scope',
  },
  'fixture:cal:debrief': {
    companyName: 'MAHLE',
    oppCode: 'OP-2045',
    subject: 'MAHLE — Plant IT debrief',
  },
};

/**
 * Per-visitor demo door. Same clock keys as the fixture workspace, filed on
 * the accounts that door already seeds.
 */
export const DEMO_CALENDAR_LINKS: Readonly<Record<string, FixtureCalendarLink>> = {
  'fixture:cal:architecture': {
    companyName: 'Siemens',
    oppCode: 'OP-0001',
    subject: 'Siemens — Architecture review',
  },
  'fixture:cal:workshop': {
    companyName: 'IKEA',
    oppCode: 'OP-0002',
    subject: 'IKEA — Cloud workshop',
  },
  'fixture:cal:steering': {
    companyName: 'Sanofi',
    oppCode: 'OP-0003',
    subject: 'Sanofi — Steering',
  },
  'fixture:cal:identity': {
    companyName: 'HSBC',
    oppCode: 'OP-0004',
    subject: 'HSBC — Identity scope',
  },
  'fixture:cal:debrief': {
    companyName: 'Northwind Pharma',
    oppCode: null,
    subject: 'Northwind Pharma — Working session',
  },
};

/**
 * Upsert the synthetic meetings the calendar clock knows how to slide.
 * Stored instants stay on the May anchor, so a booking page that reads
 * start_at does not treat them as this week's busy time. Idempotent on
 * (org, clientRequestId). A re-seed puts the anchor times back.
 */
export async function seedFixtureCalendar(
  prisma: SeedClient,
  orgId: string,
  ownerId: string,
  links: Readonly<Record<string, FixtureCalendarLink>>,
): Promise<number> {
  let written = 0;
  for (const event of FIXTURE_CALENDAR_EVENTS) {
    const link = links[event.clientRequestId];
    const subject = link?.subject ?? event.subject;
    const company = link
      ? await prisma.company.findFirst({
          where: { orgId, name: link.companyName, deletedAt: null },
          select: { id: true },
        })
      : null;
    const opportunity = link?.oppCode
      ? await prisma.opportunity.findFirst({
          where: { orgId, code: link.oppCode, deletedAt: null },
          select: { id: true, companyId: true },
        })
      : null;
    const data = {
      ownerId,
      provider: 'google_workspace' as const,
      externalId: null,
      subject,
      bodyPreview: null,
      startAt: new Date(event.startAt),
      endAt: new Date(event.endAt),
      location: event.location,
      isAllDay: false,
      isCancelled: false,
      attendees: [],
      companyId: company?.id ?? opportunity?.companyId ?? null,
      opportunityId: opportunity?.id ?? null,
      filedManually: true,
      syncState: 'SYNCED' as const,
      deletedAt: null,
    };
    const existing = await prisma.calendarEvent.findFirst({
      where: { orgId, clientRequestId: event.clientRequestId },
      select: { id: true },
    });
    if (existing) {
      await prisma.calendarEvent.update({ where: { id: existing.id }, data });
    } else {
      await prisma.calendarEvent.create({
        data: { orgId, clientRequestId: event.clientRequestId, ...data },
      });
    }
    written += 1;
  }
  return written;
}
