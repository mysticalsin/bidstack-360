import { randomUUID } from 'node:crypto';

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma, syncCalendarEventActivity, syncEmailMessageActivity } from '@bidstack/db';

import { buildServer } from '../server.js';
import { createIsolatedOrg, dropIsolatedOrg, useIsolatedOrgAuth } from '../test-support/isolated-org.js';

// Synced Outlook meetings and emails reach the account page: the bridge turns
// filed CalendarEvent and EmailMessage rows into activities, the conversations
// route lists them with their source, the charts count them, and re-filing a
// meeting through the calendar route moves its activity.
describe('GET /api/v1/companies/:id/conversations', () => {
  let server: FastifyInstance;
  let orgId: string;
  let otherOrgId: string;
  let userId: string;
  let restoreAuth: () => void;
  let companyId: string;
  let foreignCompanyId: string;
  let foreignOppId: string;
  let oppA: string;
  let oppB: string;
  let eventId: string;
  const run = randomUUID().slice(0, 8);
  const domain = `acme-${run}.example.com`;
  const hourAgo = new Date(Date.now() - 2 * 3600 * 1000);

  async function opp(org: string, company: string, name: string) {
    const row = await prisma.opportunity.create({
      data: {
        orgId: org,
        code: `OP-${randomUUID().slice(0, 8)}`,
        customer: name,
        name,
        stage: 's1_ongoing',
        valueMicros: 1_000_000,
        probability: 20,
        intel: {},
        companyId: company,
      },
    });
    return row.id;
  }

  beforeAll(async () => {
    const org = await createIsolatedOrg('convos');
    orgId = org.orgId;
    restoreAuth = useIsolatedOrgAuth(org.clerkOrg);
    const other = await createIsolatedOrg('convos-other');
    otherOrgId = other.orgId;
    const user = await prisma.user.findFirstOrThrow({ where: { orgId }, orderBy: { createdAt: 'asc' } });
    userId = user.id;

    const company = await prisma.company.create({ data: { orgId, name: `Acme ${run}`, domain } });
    companyId = company.id;
    oppA = await opp(orgId, companyId, 'Data platform');
    oppB = await opp(orgId, companyId, 'Cloud move');
    await prisma.contact.create({
      data: { orgId, companyId, customer: company.name, name: 'Jane Buyer', email: `jane@${domain}` },
    });
    const foreign = await prisma.company.create({ data: { orgId: otherOrgId, name: `Foreign ${run}` } });
    foreignCompanyId = foreign.id;
    foreignOppId = await opp(otherOrgId, foreignCompanyId, 'Not yours');

    const event = await prisma.calendarEvent.create({
      data: {
        orgId,
        ownerId: userId,
        provider: 'microsoft_graph',
        externalId: `AAMk-${run}`,
        subject: 'Discovery with Acme',
        startAt: hourAgo,
        endAt: new Date(hourAgo.getTime() + 3600 * 1000),
        attendees: [{ email: `jane@${domain}` }, { email: `bob@${domain}` }],
        organizerEmail: user.email,
        companyId,
      },
    });
    eventId = event.id;
    expect((await syncCalendarEventActivity(orgId, eventId, { hints: { channel: 'teams' } })).action).toBe('created');

    const email = await prisma.emailMessage.create({
      data: {
        orgId,
        userId,
        integrationTokenId: randomUUID(),
        provider: 'OUTLOOK',
        externalMessageId: `msg-${run}`,
        fromEmail: `jane@${domain}`,
        toEmails: [{ email: user.email }],
        subject: 'Re: scope',
        bodyText: 'body stays on the message',
        receivedAt: new Date(hourAgo.getTime() - 3600 * 1000),
        isOutbound: false,
        companyId,
        opportunityId: oppA,
      },
    });
    expect((await syncEmailMessageActivity(orgId, email.id)).action).toBe('created');

    await prisma.activity.create({
      data: {
        orgId,
        type: 'meeting',
        subject: 'Lunch logged by hand',
        entityType: 'company',
        entityId: companyId,
        status: 'completed',
        occurredAt: new Date(hourAgo.getTime() - 2 * 3600 * 1000),
      },
    });

    server = await buildServer();
    await server.ready();
  });

  afterAll(async () => {
    await server?.close();
    restoreAuth?.();
    await dropIsolatedOrg(orgId);
    await dropIsolatedOrg(otherOrgId);
  });

  async function list() {
    const res = await server.inject({ method: 'GET', url: `/api/v1/companies/${companyId}/conversations` });
    expect(res.statusCode, res.body).toBe(200);
    return res.json() as {
      items: Array<Record<string, unknown> & { subject: string }>;
      openOpportunities: Array<{ id: string; name: string }>;
    };
  }

  it('lists synced meetings and emails with their source next to rows logged in Polo', async () => {
    const body = await list();
    expect(body.items.map((i) => i.subject)).toEqual(['Discovery with Acme', 'Re: scope', 'Lunch logged by hand']);
    expect(body.items[0]).toMatchObject({
      type: 'meeting',
      source: 'teams',
      sourceLabel: 'Teams',
      channel: 'teams',
      filing: 'automatic',
      needsOpportunity: true,
      opportunity: null,
      participantCount: 3,
      canRefile: true,
      sourceRecord: { kind: 'calendar_event', id: eventId },
    });
    expect(body.items[1]).toMatchObject({
      type: 'email',
      sourceLabel: 'Outlook',
      direction: 'inbound',
      opportunity: { id: oppA, name: 'Data platform' },
      canRefile: false,
    });
    expect(body.items[2]).toMatchObject({ source: null, sourceLabel: 'Logged in Polo', filing: null });
    expect(JSON.stringify(body)).not.toContain('body stays on the message');
    expect(body.openOpportunities.map((o) => o.id).sort()).toEqual([oppA, oppB].sort());
  });

  it('feeds the account activity charts', async () => {
    const res = await server.inject({
      method: 'GET',
      url: `/api/v1/companies/${companyId}/activity-summary?tz=UTC&weeks=2`,
    });
    expect(res.statusCode, res.body).toBe(200);
    const weekly = res.json().weekly as Array<{ meeting: number; email: number }>;
    expect(weekly.reduce((n, w) => n + w.meeting, 0)).toBeGreaterThanOrEqual(2);
    expect(weekly.reduce((n, w) => n + w.email, 0)).toBe(1);
  });

  it('links attendees to the contact and keeps unknown addresses only', async () => {
    const activity = await prisma.activity.findFirstOrThrow({
      where: { orgId, subject: 'Discovery with Acme' },
      select: { attendees: { select: { contactId: true, userId: true, email: true } } },
    });
    expect(activity.attendees).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ contactId: expect.any(String), email: null }),
        expect.objectContaining({ contactId: null, userId: null, email: `bob@${domain}` }),
        expect.objectContaining({ userId, email: null }),
      ]),
    );
  });

  it('moves the meeting when it is re-filed through the calendar route', async () => {
    const res = await server.inject({
      method: 'PATCH',
      url: `/api/v1/calendar/events/${eventId}`,
      payload: { opportunityId: oppB },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ opportunityId: oppB, companyId });

    const meeting = (await list()).items.find((i) => i.subject === 'Discovery with Acme');
    expect(meeting).toMatchObject({
      filing: 'manual',
      needsOpportunity: false,
      opportunity: { id: oppB, name: 'Cloud move' },
    });
  });

  it('refuses to file a meeting on another org opportunity', async () => {
    const res = await server.inject({
      method: 'PATCH',
      url: `/api/v1/calendar/events/${eventId}`,
      payload: { opportunityId: foreignOppId },
    });
    expect(res.statusCode).toBe(404);
  });

  it('does not show another org account', async () => {
    const res = await server.inject({ method: 'GET', url: `/api/v1/companies/${foreignCompanyId}/conversations` });
    expect(res.statusCode).toBe(404);
  });
});
