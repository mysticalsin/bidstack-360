/**
 * Calendar event routes: range overlap, validation, tenant isolation,
 * pagination bounds and read-only grants (events stay in Polo, nothing is
 * pushed to a real calendar).
 */
import { randomUUID } from 'node:crypto';

import { IntegrationProvider, prisma } from '@bidstack/db';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { buildServer } from '../server.js';
import { createIsolatedOrg, dropIsolatedOrg, useIsolatedOrgAuth } from '../test-support/isolated-org.js';

let server: FastifyInstance;
let orgId = '';
let otherOrgId = '';
let userId = '';
let otherUserId = '';
let restoreAuth: (() => void) | null = null;

async function seedEvent(over: { org?: string; user?: string; start: string; end: string; subject?: string; allDay?: boolean }) {
  return prisma.calendarEvent.create({
    data: {
      orgId: over.org ?? orgId,
      ownerId: over.user ?? userId,
      externalId: `ext-${randomUUID()}`,
      provider: IntegrationProvider.microsoft_graph,
      subject: over.subject ?? 'Meeting',
      startAt: new Date(over.start),
      endAt: new Date(over.end),
      isAllDay: over.allDay ?? false,
    },
  });
}

beforeAll(async () => {
  const org = await createIsolatedOrg('calevents');
  orgId = org.orgId;
  restoreAuth = useIsolatedOrgAuth(org.clerkOrg);
  const other = await createIsolatedOrg('calevents_other');
  otherOrgId = other.orgId;
  server = await buildServer();
  await server.ready();
  userId = (await prisma.user.findFirst({ where: { orgId }, orderBy: { createdAt: 'asc' }, select: { id: true } }))!.id;
  otherUserId = (await prisma.user.findFirst({ where: { orgId: otherOrgId }, select: { id: true } }))!.id;
});

afterAll(async () => {
  await server?.close();
  restoreAuth?.();
  if (orgId) await dropIsolatedOrg(orgId);
  if (otherOrgId) await dropIsolatedOrg(otherOrgId);
});

beforeEach(async () => {
  await prisma.calendarEvent.deleteMany({ where: { orgId: { in: [orgId, otherOrgId] } } });
  await prisma.integrationToken.deleteMany({ where: { orgId } });
});

describe('GET /calendar/events', () => {
  it('returns events overlapping the range, including multi-day ones, for this org only', async () => {
    await seedEvent({ start: '2031-03-01T00:00:00Z', end: '2031-03-04T00:00:00Z', subject: 'Offsite', allDay: true });
    await seedEvent({ start: '2031-03-02T14:00:00Z', end: '2031-03-02T15:00:00Z', subject: 'Call' });
    await seedEvent({ start: '2031-03-10T14:00:00Z', end: '2031-03-10T15:00:00Z', subject: 'Later' });
    await seedEvent({ org: otherOrgId, user: otherUserId, start: '2031-03-02T14:00:00Z', end: '2031-03-02T15:00:00Z', subject: 'Foreign' });
    const res = await server.inject({
      method: 'GET',
      url: '/api/v1/calendar/events?from=2031-03-02T00:00:00Z&to=2031-03-03T00:00:00Z',
    });
    expect(res.statusCode).toBe(200);
    const items = res.json<{ items: Array<{ subject: string; companyId: string | null; localOnly: boolean }> }>().items;
    expect(items.map((e) => e.subject)).toEqual(['Offsite', 'Call']);
    expect(items[0]).toHaveProperty('companyId', null);
    expect(items[0]).toHaveProperty('localOnly', false);
  });

  it('rejects out-of-range limits', async () => {
    for (const limit of [0, 201]) {
      const res = await server.inject({ method: 'GET', url: `/api/v1/calendar/events?limit=${limit}` });
      expect(res.statusCode).toBe(400);
    }
  });
});

describe('POST /calendar/events', () => {
  const body = {
    subject: 'Bid review',
    startAt: '2031-03-05T15:00:00Z',
    endAt: '2031-03-05T16:00:00Z',
  };

  it('rejects an event that ends before it starts', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/calendar/events',
      payload: { ...body, endAt: '2031-03-05T14:00:00Z' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('keeps the event in Polo when the calendar grant is read-only', async () => {
    await prisma.integrationToken.create({
      data: {
        orgId,
        userId,
        provider: IntegrationProvider.microsoft_graph,
        accessTokenEncrypted: 'ciphertext-placeholder',
        scope: ['https://graph.microsoft.com/Calendars.Read', 'https://graph.microsoft.com/Mail.Read'],
        status: 'active',
      },
    });
    const res = await server.inject({ method: 'POST', url: '/api/v1/calendar/events', payload: body });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ syncState: 'SYNCED', localOnly: true });
  });

  it('is idempotent on retry with the same client request id', async () => {
    const clientRequestId = randomUUID();
    const first = await server.inject({ method: 'POST', url: '/api/v1/calendar/events', payload: { ...body, clientRequestId } });
    const retry = await server.inject({ method: 'POST', url: '/api/v1/calendar/events', payload: { ...body, clientRequestId } });
    expect(first.statusCode).toBe(201);
    expect(retry.statusCode).toBe(200);
    expect(retry.json<{ id: string }>().id).toBe(first.json<{ id: string }>().id);
  });
});

describe('PATCH and DELETE /calendar/events/:id', () => {
  it('returns 404 for another org event', async () => {
    const foreign = await seedEvent({ org: otherOrgId, user: otherUserId, start: '2031-03-02T14:00:00Z', end: '2031-03-02T15:00:00Z' });
    const patch = await server.inject({ method: 'PATCH', url: `/api/v1/calendar/events/${foreign.id}`, payload: { subject: 'x' } });
    expect(patch.statusCode).toBe(404);
    const del = await server.inject({ method: 'DELETE', url: `/api/v1/calendar/events/${foreign.id}` });
    expect(del.statusCode).toBe(404);
  });

  it('filing an event by hand marks it so the calendar pull keeps that filing', async () => {
    const own = await seedEvent({ start: '2031-03-02T14:00:00Z', end: '2031-03-02T15:00:00Z' });
    const unknown = await server.inject({
      method: 'PATCH',
      url: `/api/v1/calendar/events/${own.id}`,
      payload: { companyId: randomUUID() },
    });
    expect(unknown.statusCode).toBe(404);
    const { id: companyId } = await prisma.company.create({
      data: { orgId, name: `Filing target ${randomUUID().slice(0, 8)}` },
      select: { id: true },
    });
    const res = await server.inject({
      method: 'PATCH',
      url: `/api/v1/calendar/events/${own.id}`,
      payload: { companyId },
    });
    expect(res.statusCode).toBe(200);
    const row = await prisma.calendarEvent.findUniqueOrThrow({
      where: { id: own.id },
      select: { companyId: true, filedManually: true },
    });
    expect(row).toEqual({ companyId, filedManually: true });

    const renamed = await seedEvent({ start: '2031-03-03T14:00:00Z', end: '2031-03-03T15:00:00Z' });
    await server.inject({
      method: 'PATCH',
      url: `/api/v1/calendar/events/${renamed.id}`,
      payload: { subject: 'Renamed' },
    });
    const untouched = await prisma.calendarEvent.findUniqueOrThrow({
      where: { id: renamed.id },
      select: { filedManually: true },
    });
    expect(untouched.filedManually).toBe(false);
  });

  it('rejects a patch that would end before it starts', async () => {
    const own = await seedEvent({ start: '2031-03-02T14:00:00Z', end: '2031-03-02T15:00:00Z' });
    const res = await server.inject({
      method: 'PATCH',
      url: `/api/v1/calendar/events/${own.id}`,
      payload: { endAt: '2031-03-02T13:00:00Z' },
    });
    expect(res.statusCode).toBe(400);
  });
});
