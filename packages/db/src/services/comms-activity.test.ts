import { describe, expect, it } from 'vitest';

import { subscribeAccountActivityCreated } from './account-activity-events.js';
import { commsActivityKey, createCommsActivityBridge, type CommsBridgeDb } from './comms-activity.js';

const ORG = '00000000-0000-4000-8000-000000000001';
const OTHER_ORG = '00000000-0000-4000-8000-0000000000ff';
const OWNER = '00000000-0000-4000-8000-000000000010';
const COLLEAGUE = '00000000-0000-4000-8000-000000000011';
const COMPANY = '00000000-0000-4000-8000-000000000020';
const OPP_A = '00000000-0000-4000-8000-000000000030';
const OPP_B = '00000000-0000-4000-8000-000000000031';
const CONTACT = '00000000-0000-4000-8000-000000000040';
const EVENT = '00000000-0000-4000-8000-000000000050';
const EMAIL = '00000000-0000-4000-8000-000000000060';

type Row = Record<string, unknown> & { id: string; orgId: string; deletedAt?: Date | null };

function matches(row: Row, where: Record<string, unknown>): boolean {
  for (const [k, v] of Object.entries(where)) {
    const value = row[k];
    if (k === 'deletedAt') {
      if (v === null && value != null) return false;
      if (v && typeof v === 'object' && 'not' in v && value == null) return false;
      continue;
    }
    if (v && typeof v === 'object' && !(v instanceof Date)) {
      const op = v as { in?: unknown[]; notIn?: unknown[] };
      if (op.in && !op.in.includes(value)) return false;
      if (op.notIn && op.notIn.includes(value)) return false;
      continue;
    }
    if (value !== v) return false;
  }
  return true;
}

function table(rows: Row[] = []) {
  // Live rows only unless the caller filters on deletedAt, like the soft-delete middleware.
  const scoped = (where: Record<string, unknown>) =>
    rows.filter((r) => matches(r, 'deletedAt' in where ? where : { ...where, deletedAt: null }));
  return {
    rows,
    findFirst: async ({ where }: { where: Record<string, unknown> }) => scoped(where)[0] ?? null,
    findMany: async ({ where, take }: { where: Record<string, unknown>; take?: number }) =>
      scoped(where).slice(0, take ?? 1000),
    updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      const hit = scoped(where);
      for (const r of hit) Object.assign(r, data);
      return { count: hit.length };
    },
    create: async ({ data }: { data: Record<string, unknown> }) => {
      if (data.idempotencyKey && rows.some((r) => r.idempotencyKey === data.idempotencyKey)) {
        throw Object.assign(new Error('unique'), { code: 'P2002' });
      }
      const row = { id: `act-${rows.length + 1}`, deletedAt: null, ...data } as Row;
      rows.push(row);
      return { id: row.id };
    },
    deleteMany: async ({ where }: { where: Record<string, unknown> }) => {
      const keep = rows.filter((r) => !matches(r, where));
      const count = rows.length - keep.length;
      rows.splice(0, rows.length, ...keep);
      return { count };
    },
    createMany: async ({ data }: { data: Row[] }) => {
      for (const d of data) rows.push({ id: `att-${rows.length + 1}`, deletedAt: null, ...d });
      return { count: data.length };
    },
  };
}

interface Fixture {
  events?: Row[];
  emails?: Row[];
  opportunities?: Row[];
  contacts?: Row[];
}

function fakeDb(f: Fixture = {}) {
  const db = {
    user: table([
      { id: OWNER, orgId: ORG, email: 'tony@amaris.com', microsoftEmail: null },
      { id: COLLEAGUE, orgId: ORG, email: 'sam@amaris.com', microsoftEmail: null },
      { id: 'u-other', orgId: OTHER_ORG, email: 'eve@acme.com', microsoftEmail: null },
    ]),
    opportunity: table(f.opportunities ?? []),
    contact: table(
      f.contacts ?? [{ id: CONTACT, orgId: ORG, email: 'jane@acme.com', companyId: COMPANY, deletedAt: null }],
    ),
    calendarEvent: table(f.events ?? []),
    emailMessage: table(f.emails ?? []),
    activity: table(),
    activityAttendee: table(),
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db),
  };
  return db;
}

function event(over: Record<string, unknown> = {}): Row {
  return {
    id: EVENT,
    orgId: ORG,
    ownerId: OWNER,
    provider: 'microsoft_graph',
    externalId: 'AAMk-1',
    subject: 'Discovery call',
    startAt: new Date('2026-11-02T15:00:00Z'),
    endAt: new Date('2026-11-02T16:00:00Z'),
    isCancelled: false,
    syncState: 'SYNCED',
    attendees: [
      { email: 'Jane@Acme.com', responseStatus: 'accepted' },
      { email: 'bob@acme.com' },
      { email: 'sam@amaris.com', responseStatus: 'tentativelyAccepted' },
    ],
    organizerEmail: 'tony@amaris.com',
    companyId: COMPANY,
    opportunityId: null,
    contactId: CONTACT,
    filedManually: false,
    deletedAt: null,
    ...over,
  };
}

const bridgeFor = (db: ReturnType<typeof fakeDb>) => createCommsActivityBridge(db as unknown as CommsBridgeDb);
const meta = (row: Row | undefined) => (row?.metadata as { commsCapture: Record<string, unknown> }).commsCapture;

describe('comms activity bridge: meetings', () => {
  it('creates one activity per provider item and updates it on replay', async () => {
    const db = fakeDb({ events: [event()] });
    const bridge = bridgeFor(db);

    const first = await bridge.syncCalendarEvent(ORG, EVENT, { hints: { channel: 'teams' } });
    const second = await bridge.syncCalendarEvent(ORG, EVENT);

    expect(first.action).toBe('created');
    expect(second).toEqual({ action: 'updated', activityId: first.activityId });
    expect(db.activity.rows).toHaveLength(1);
    const row = db.activity.rows[0]!;
    expect(row).toMatchObject({
      orgId: ORG,
      type: 'meeting',
      subject: 'Discovery call',
      entityType: 'company',
      entityId: COMPANY,
      status: 'completed',
      actorType: 'system',
      idempotencyKey: commsActivityKey(ORG, 'microsoft_graph', 'meeting', 'AAMk-1'),
    });
    expect(row.description).toBeNull();
    // The Teams hint from the first pull survives a replay without hints.
    expect(meta(row)).toMatchObject({ source: 'teams', channel: 'teams', participantCount: 4, sourceId: EVENT });
    expect(db.activityAttendee.rows).toHaveLength(4);
  });

  it('links attendees to contacts and users, keeping the address only when unknown', async () => {
    const db = fakeDb({ events: [event()] });
    await bridgeFor(db).syncCalendarEvent(ORG, EVENT);

    const att = db.activityAttendee.rows.map((r) => ({
      contactId: r.contactId,
      userId: r.userId,
      email: r.email,
      responseStatus: r.responseStatus,
    }));
    expect(att).toEqual(
      expect.arrayContaining([
        { contactId: CONTACT, userId: null, email: null, responseStatus: 'accepted' },
        { contactId: null, userId: null, email: 'bob@acme.com', responseStatus: 'needs_action' },
        { contactId: null, userId: COLLEAGUE, email: null, responseStatus: 'tentative' },
        { contactId: null, userId: OWNER, email: null, responseStatus: 'needs_action' },
      ]),
    );
    expect(db.activityAttendee.rows.every((r) => r.orgId === ORG)).toBe(true);
  });

  it('skips a meeting where everyone is internal', async () => {
    const db = fakeDb({
      events: [event({ attendees: [{ email: 'sam@amaris.com' }, { email: 'kim@amaris.com' }] })],
    });
    const out = await bridgeFor(db).syncCalendarEvent(ORG, EVENT);
    expect(out).toEqual({ action: 'skipped', reason: 'internal_only', activityId: null });
    expect(db.activity.rows).toHaveLength(0);
  });

  it('remembers a private meeting so a hintless sync cannot publish it', async () => {
    const db = fakeDb({ events: [event()] });
    const bridge = bridgeFor(db);

    // The first pull never creates a visible activity, but it must store the
    // privacy flag. The calendar route and removal sync call the bridge again
    // without hints; forgetting the flag would put the subject back on the account.
    const skipped = await bridge.syncCalendarEvent(ORG, EVENT, { hints: { isPrivate: true, channel: 'teams' } });
    expect(skipped).toMatchObject({ action: 'skipped', reason: 'private' });
    expect(db.activity.rows).toHaveLength(1);
    expect(db.activity.rows[0]!.deletedAt).toBeInstanceOf(Date);
    expect(db.activity.rows[0]!.subject).toBeNull();
    expect(meta(db.activity.rows[0])).toMatchObject({ isPrivate: true, removedBy: 'sync', channel: 'teams' });
    expect(db.activityAttendee.rows).toHaveLength(0);

    const hintless = await bridge.syncCalendarEvent(ORG, EVENT);
    expect(hintless).toMatchObject({ action: 'skipped', reason: 'private' });
    expect(db.activity.rows[0]!.deletedAt).toBeInstanceOf(Date);
    expect(db.activity.rows[0]!.subject).toBeNull();

    const created = await bridge.syncCalendarEvent(ORG, EVENT, { hints: { isPrivate: false } });
    expect(created).toEqual({ action: 'created', activityId: skipped.activityId });
    expect(db.activity.rows).toHaveLength(1);
    expect(db.activity.rows[0]!.deletedAt).toBeNull();
    expect(db.activity.rows[0]!.subject).toBe('Discovery call');

    const removed = await bridge.syncCalendarEvent(ORG, EVENT, { hints: { isPrivate: true } });
    expect(removed).toEqual({ action: 'removed', activityId: created.activityId });
    expect(db.activity.rows[0]!.deletedAt).toBeInstanceOf(Date);
    expect(db.activity.rows[0]!.subject).toBeNull();
    expect(meta(db.activity.rows[0])).toMatchObject({ isPrivate: true, removedBy: 'sync' });
    expect(db.activityAttendee.rows).toHaveLength(0);

    // Filing the same event through the calendar route has no privacy hint.
    const again = await bridge.syncCalendarEvent(ORG, EVENT, { actorUserId: OWNER });
    expect(again).toMatchObject({ action: 'skipped', reason: 'private' });
    expect(db.activity.rows[0]!.deletedAt).toBeInstanceOf(Date);
  });

  it('hides a meeting that becomes private and cancelled in the same pull', async () => {
    const db = fakeDb({ events: [event()] });
    const bridge = bridgeFor(db);
    const created = await bridge.syncCalendarEvent(ORG, EVENT);
    db.calendarEvent.rows[0]!.isCancelled = true;
    const out = await bridge.syncCalendarEvent(ORG, EVENT, { hints: { isPrivate: true } });
    expect(out).toEqual({ action: 'removed', activityId: created.activityId });
    expect(db.activity.rows[0]!.deletedAt).toBeInstanceOf(Date);
    expect(meta(db.activity.rows[0]).isPrivate).toBe(true);
    // A later hintless pull still must not leave a cancelled row on the account page.
    const hintless = await bridge.syncCalendarEvent(ORG, EVENT);
    expect(hintless).toMatchObject({ action: 'skipped', reason: 'private' });
    expect(db.activity.rows[0]!.deletedAt).toBeInstanceOf(Date);
  });

  it('never creates a declined or cancelled meeting, and cancels an existing one in place', async () => {
    const declined = fakeDb({ events: [event()] });
    expect(await bridgeFor(declined).syncCalendarEvent(ORG, EVENT, { hints: { ownerDeclined: true } })).toEqual({
      action: 'skipped',
      reason: 'declined',
      activityId: null,
    });

    const db = fakeDb({ events: [event()] });
    const bridge = bridgeFor(db);
    const created = await bridge.syncCalendarEvent(ORG, EVENT);
    db.calendarEvent.rows[0]!.isCancelled = true;
    const out = await bridge.syncCalendarEvent(ORG, EVENT);
    expect(out).toEqual({ action: 'cancelled', activityId: created.activityId });
    expect(db.activity.rows).toHaveLength(1);
    expect(db.activity.rows[0]).toMatchObject({ status: 'cancelled', deletedAt: null });
  });

  it('files to the account only and flags it when several opportunities are open', async () => {
    const db = fakeDb({
      events: [event()],
      opportunities: [
        { id: OPP_A, orgId: ORG, companyId: COMPANY, stage: 'proposal', deletedAt: null },
        { id: OPP_B, orgId: ORG, companyId: COMPANY, stage: 'qualification', deletedAt: null },
      ],
    });
    await bridgeFor(db).syncCalendarEvent(ORG, EVENT);
    expect(db.activity.rows[0]).toMatchObject({ entityType: 'company', entityId: COMPANY });
    expect(meta(db.activity.rows[0]).needsOpportunity).toBe(true);
  });

  it('moves the activity when the meeting is refiled by hand', async () => {
    const db = fakeDb({
      events: [event()],
      opportunities: [
        { id: OPP_A, orgId: ORG, companyId: COMPANY, stage: 'proposal', deletedAt: null },
        { id: OPP_B, orgId: ORG, companyId: COMPANY, stage: 'qualification', deletedAt: null },
      ],
    });
    const bridge = bridgeFor(db);
    const created = await bridge.syncCalendarEvent(ORG, EVENT);
    Object.assign(db.calendarEvent.rows[0]!, { opportunityId: OPP_B, filedManually: true });
    const out = await bridge.syncCalendarEvent(ORG, EVENT, { actorUserId: OWNER });
    expect(out).toEqual({ action: 'updated', activityId: created.activityId });
    expect(db.activity.rows[0]).toMatchObject({ entityType: 'opportunity', entityId: OPP_B });
    expect(meta(db.activity.rows[0])).toMatchObject({ filedManually: true, needsOpportunity: false });
  });

  it('does nothing for an unfiled meeting or another org', async () => {
    const db = fakeDb({ events: [event({ companyId: null, contactId: null })] });
    const bridge = bridgeFor(db);
    expect((await bridge.syncCalendarEvent(ORG, EVENT)).action).toBe('skipped');
    expect(await bridge.syncCalendarEvent(OTHER_ORG, EVENT)).toEqual({
      action: 'skipped',
      reason: 'not_found',
      activityId: null,
    });
    expect(db.activity.rows).toHaveLength(0);
  });

  it('leaves a row a person deleted alone', async () => {
    const db = fakeDb({ events: [event()] });
    const bridge = bridgeFor(db);
    await bridge.syncCalendarEvent(ORG, EVENT);
    db.activity.rows[0]!.deletedAt = new Date();
    const out = await bridge.syncCalendarEvent(ORG, EVENT);
    expect(out.action).toBe('skipped');
    expect(out).toMatchObject({ reason: 'deleted_by_user' });
    expect(db.activity.rows[0]!.deletedAt).toBeInstanceOf(Date);
  });

  it('announces new account activity once, with no actor for automatic filing', async () => {
    const seen: unknown[] = [];
    const off = subscribeAccountActivityCreated((e) => {
      seen.push(e);
    });
    const failing = subscribeAccountActivityCreated(() => {
      throw new Error('subscriber down');
    });
    try {
      const db = fakeDb({ events: [event()] });
      const bridge = bridgeFor(db);
      const created = await bridge.syncCalendarEvent(ORG, EVENT);
      await bridge.syncCalendarEvent(ORG, EVENT);
      expect(seen).toEqual([{ orgId: ORG, companyId: COMPANY, activityId: created.activityId, actorUserId: null }]);
    } finally {
      off();
      failing();
    }
  });
});

describe('comms activity bridge: emails', () => {
  function email(over: Record<string, unknown> = {}): Row {
    return {
      id: EMAIL,
      orgId: ORG,
      userId: OWNER,
      provider: 'OUTLOOK',
      externalMessageId: 'msg-1',
      subject: 'Re: proposal',
      fromEmail: 'jane@acme.com',
      toEmails: [{ email: 'tony@amaris.com' }],
      ccEmails: [],
      sentAt: new Date('2026-11-03T10:00:00Z'),
      receivedAt: new Date('2026-11-03T10:00:05Z'),
      createdAt: new Date('2026-11-03T10:01:00Z'),
      isOutbound: false,
      bodyText: 'secret body',
      companyId: COMPANY,
      opportunityId: OPP_A,
      contactId: CONTACT,
      deletedAt: null,
      ...over,
    };
  }

  it('creates an email activity with direction and no body', async () => {
    const db = fakeDb({ emails: [email()] });
    const out = await bridgeFor(db).syncEmailMessage(ORG, EMAIL);
    expect(out.action).toBe('created');
    const row = db.activity.rows[0]!;
    expect(row).toMatchObject({ type: 'email', entityType: 'opportunity', entityId: OPP_A, startTime: null });
    expect(meta(row)).toMatchObject({ source: 'outlook', direction: 'inbound', participantCount: 2 });
    expect(JSON.stringify(row)).not.toContain('secret body');
  });

  it('removes the activity when the email is deleted', async () => {
    const db = fakeDb({ emails: [email()] });
    const bridge = bridgeFor(db);
    const created = await bridge.syncEmailMessage(ORG, EMAIL);
    db.emailMessage.rows[0]!.deletedAt = new Date();
    expect(await bridge.syncEmailMessage(ORG, EMAIL)).toEqual({ action: 'removed', activityId: created.activityId });
  });

  it('labels Gmail and skips internal-only threads', async () => {
    const db = fakeDb({
      emails: [email({ provider: 'GMAIL', fromEmail: 'sam@amaris.com', toEmails: [{ email: 'tony@amaris.com' }] })],
    });
    expect((await bridgeFor(db).syncEmailMessage(ORG, EMAIL)).action).toBe('skipped');

    const gmail = fakeDb({ emails: [email({ provider: 'GMAIL' })] });
    await bridgeFor(gmail).syncEmailMessage(ORG, EMAIL);
    expect(meta(gmail.activity.rows[0]).source).toBe('gmail');
  });
});
