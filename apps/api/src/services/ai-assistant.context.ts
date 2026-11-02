/**
 * ai-assistant.context.ts — Prisma context builders for each AI feature.
 *
 * WHY separate from service.ts: each function is a pure Prisma query bundle
 * that assembles a structured context object. Extracting them keeps the
 * orchestrator (service.ts) focused on cap-check → prompt → LLM → parse →
 * persist, without drowning in query boilerplate.
 *
 * Import DAG: imports from ai-assistant.helpers (leaf). Imported by service.ts.
 * Zero dependency cycles — helpers ← context ← service.
 */
import { z } from 'zod';

import { prisma } from '@bidstack/db';

import { sanitiseContactForPrompt } from './ai-assistant.helpers.js';

// ─── Email draft context ──────────────────────────────────────────────────

export async function buildEmailDraftContext(
  orgId: string,
  contactId?: string,
  dealId?: string,
): Promise<{ contextStr: string }> {
  const parts: string[] = [];

  if (contactId) {
    const contact = await prisma.contact.findFirst({
      where: { id: contactId, orgId, deletedAt: null },
      select: { id: true, name: true, email: true, phone: true, role: true, aiOptOut: true },
    });
    if (contact) {
      const safe = sanitiseContactForPrompt(contact);
      parts.push(
        `Contact: ${safe.name}${safe.role ? ` (${safe.role})` : ''}${safe.email ? `, ${safe.email}` : ''}`,
      );
    }
  }

  if (dealId) {
    const opp = await prisma.opportunity.findFirst({
      where: { id: dealId, orgId, deletedAt: null },
      select: { name: true, stage: true, valueMicros: true },
    });
    if (opp) {
      const valueStr = opp.valueMicros
        ? `$${(Number(opp.valueMicros) / 1_000_000).toFixed(0)}`
        : '';
      parts.push(
        `Deal: "${opp.name}" — stage: ${String(opp.stage)}${valueStr ? `, value: ${valueStr}` : ''}`,
      );
    }
  }

  return { contextStr: parts.length ? `\n\nContext:\n${parts.join('\n')}` : '' };
}

// ─── Deal sentiment context ───────────────────────────────────────────────

export async function buildSentimentContext(orgId: string, dealId: string) {
  const opp = await prisma.opportunity.findFirst({
    where: { id: dealId, orgId, deletedAt: null },
    select: { id: true, name: true, stage: true },
  });
  if (!opp) {
    throw Object.assign(new Error('Deal not found'), { statusCode: 404 });
  }

  const activities = await prisma.activity.findMany({
    where: { orgId, entityType: 'opportunity', entityId: dealId, deletedAt: null },
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: { type: true, subject: true, description: true, createdAt: true },
  });

  const activitiesSummary = activities
    .map(
      (a) =>
        `[${String(a.type)}] ${a.subject ?? ''}: ${a.description?.slice(0, 200) ?? '(no description)'}`,
    )
    .join('\n');

  return {
    opp: { id: opp.id, name: opp.name, stage: String(opp.stage) },
    activitiesSummary,
    activities,
  };
}

// ─── Meeting prep context ─────────────────────────────────────────────────

export async function buildMeetingContext(orgId: string, calendarEventId: string) {
  const event = await prisma.calendarEvent.findFirst({
    where: { id: calendarEventId, orgId, deletedAt: null },
    select: { id: true, subject: true, startAt: true, attendees: true, relatedEntityId: true },
  });
  if (!event) {
    throw Object.assign(new Error('Calendar event not found'), { statusCode: 404 });
  }

  // Parse attendees from the JSON column (array of { email?, displayName? }).
  const AttendeesSchema = z.array(
    z.object({ email: z.string().optional(), displayName: z.string().optional() }),
  );
  const rawAttendees = AttendeesSchema.safeParse(event.attendees);
  const attendeeEmails = rawAttendees.success
    ? rawAttendees.data.map((a) => a.email).filter(Boolean)
    : [];

  // Resolve CRM contacts matching the attendee emails.
  const contacts = await prisma.contact.findMany({
    where: { orgId, email: { in: attendeeEmails as string[] }, deletedAt: null },
    select: {
      id: true,
      name: true,
      role: true,
      email: true,
      phone: true,
      aiOptOut: true,
      customer: true,
    },
    take: 20,
  });

  const safeAttendees = contacts.map((c) => {
    const s = sanitiseContactForPrompt(c);
    return { name: s.name, role: s.role, company: c.customer };
  });

  // Pull open opportunities for the related entity if present.
  let openOpps: Array<{ id: string; title: string; stage: string }> = [];
  if (event.relatedEntityId) {
    const opps = await prisma.opportunity.findMany({
      where: {
        orgId,
        id: event.relatedEntityId,
        stage: { not: 'closed_lost' },
        deletedAt: null,
      },
      select: { id: true, name: true, stage: true },
      take: 5,
    });
    openOpps = opps.map((o) => ({ id: o.id, title: o.name, stage: String(o.stage) }));
  }

  // Recent activity for the resolved contact IDs.
  const contactIds = contacts.map((c) => c.id);
  const recentActs = contactIds.length
    ? await prisma.activity.findMany({
        where: { orgId, entityType: 'contact', entityId: { in: contactIds }, deletedAt: null },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: { type: true, subject: true, description: true, createdAt: true },
      })
    : [];

  const actSummary = recentActs.map((a) => `[${String(a.type)}] ${a.subject ?? ''}`).join('; ');
  const recentInteractions = recentActs
    .slice(0, 5)
    .map((a) => `${String(a.type)}: ${a.subject ?? ''}`);

  return {
    event: {
      id: event.id,
      subject: event.subject,
      startAt: event.startAt,
      relatedEntityId: event.relatedEntityId,
    },
    safeAttendees,
    openOpps,
    recentInteractions,
    actSummary,
  };
}

// ─── Contact enrichment context ───────────────────────────────────────────

export async function buildEnrichContext(orgId: string, contactId: string) {
  const contact = await prisma.contact.findFirst({
    where: { id: contactId, orgId, deletedAt: null },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      role: true,
      aiOptOut: true,
      customer: true,
    },
  });
  if (!contact) {
    throw Object.assign(new Error('Contact not found'), { statusCode: 404 });
  }

  const safe = sanitiseContactForPrompt(contact);
  // WHY `?? null`: split('@')[1] is undefined when no '@' present; normalise to null.
  const emailDomain =
    !contact.aiOptOut && contact.email ? (contact.email.split('@')[1] ?? null) : null;

  return { contact, safe, emailDomain };
}

// ─── Account intel context ────────────────────────────────────────────────

export async function buildAccountIntelContext(orgId: string, accountId: string) {
  const [opps, contacts] = await Promise.all([
    prisma.opportunity.findMany({
      where: { orgId, companyId: accountId, deletedAt: null },
      select: { id: true, name: true, stage: true, valueMicros: true },
      orderBy: { createdAt: 'desc' },
      take: 20,
    }),
    prisma.contact.findMany({
      where: { orgId, companyId: accountId, deletedAt: null },
      select: { id: true, name: true, role: true, aiOptOut: true },
      take: 20,
    }),
  ]);

  const oppSummary = opps
    .map(
      (o) =>
        `"${o.name}" (${String(o.stage)}${o.valueMicros ? `, $${(Number(o.valueMicros) / 1_000_000).toFixed(0)}` : ''})`,
    )
    .join(', ');

  const contactSummary = contacts
    .map((c) =>
      c.aiOptOut ? `[REDACTED] (${c.role ?? 'unknown'})` : `${c.name} (${c.role ?? 'unknown'})`,
    )
    .join(', ');

  return { opps, contacts, oppSummary, contactSummary };
}
