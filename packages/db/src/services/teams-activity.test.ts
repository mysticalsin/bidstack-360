import { describe, expect, it } from 'vitest';

import { runAccountActivityBatch, subscribeAccountActivityDigest, type AccountActivityDigest } from './account-activity-events.js';
import {
  createTeamsActivityService,
  teamsActivityKey,
  teamsThreadKey,
  teamsThreadTitle,
  type FileTeamsMessagesInput,
  type TeamsActivityDb,
} from './teams-activity.js';
import type { TeamsMessage } from './teams-graph.js';

const ORG = '00000000-0000-4000-8000-000000000001';
const OWNER = '00000000-0000-4000-8000-000000000010';
const COLLEAGUE = '00000000-0000-4000-8000-000000000011';
const ACME = '00000000-0000-4000-8000-000000000020';
const GLOBEX = '00000000-0000-4000-8000-000000000021';
const HIDDEN = '00000000-0000-4000-8000-000000000022';
const CONTACT = '00000000-0000-4000-8000-000000000040';

type Row = Record<string, unknown> & { id: string; deletedAt?: Date | null };

function matches(row: Row, where: Record<string, unknown>): boolean {
  for (const [k, v] of Object.entries(where)) {
    if (k === 'AND') {
      if (!(v as Record<string, unknown>[]).every((w) => matches(row, w))) return false;
      continue;
    }
    const value = row[k];
    if (k === 'deletedAt') {
      if (v === null && value != null) return false;
      if (v && typeof v === 'object' && 'not' in v && value == null) return false;
      continue;
    }
    if (v && typeof v === 'object' && !(v instanceof Date)) {
      const op = v as { in?: unknown[]; notIn?: unknown[]; mode?: string };
      const norm = (x: unknown) => (op.mode === 'insensitive' && typeof x === 'string' ? x.toLowerCase() : x);
      if (op.in && !op.in.map(norm).includes(norm(value))) return false;
      if (op.notIn && op.notIn.includes(value)) return false;
      continue;
    }
    if (value !== v) return false;
  }
  return true;
}

function table(rows: Row[] = []) {
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

function fixture() {
  const t = {
    activity: table(),
    activityAttendee: table(),
    contact: table([{ id: CONTACT, orgId: ORG, email: 'jane@acme.com', companyId: ACME, deletedAt: null }]),
    user: table([
      { id: OWNER, orgId: ORG, email: 'tony@mantu.com', microsoftEmail: null },
      { id: COLLEAGUE, orgId: ORG, email: 'sam@mantu.com', microsoftEmail: null },
    ]),
    company: table([
      { id: ACME, orgId: ORG, name: 'Acme', domain: 'acme.com', deletedAt: null },
      { id: GLOBEX, orgId: ORG, name: 'Globex', domain: 'globex.io', deletedAt: null },
      { id: HIDDEN, orgId: ORG, name: 'Hidden Co', domain: 'hidden.co', deletedAt: null, restricted: true },
    ]),
    opportunity: table(),
  };
  const db = {
    ...t,
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(t),
  } as unknown as TeamsActivityDb;
  return { t, db, svc: createTeamsActivityService(db) };
}

function msg(over: Partial<TeamsMessage> = {}): TeamsMessage {
  return {
    id: 'm1',
    messageType: 'message',
    createdAt: '2026-11-07T15:00:00.000Z',
    lastModifiedAt: '2026-11-07T15:00:00.000Z',
    deletedAt: null,
    authorAadId: 'aad-jane',
    authorName: 'Jane Doe',
    text: 'Can we review the RFP scope Friday?',
    attachmentNames: ['Scope v2.docx'],
    webUrl: 'https://teams.microsoft.com/l/message/19%3Aacme/m1',
    replyToId: null,
    ...over,
  };
}

function input(over: Partial<FileTeamsMessagesInput> = {}): FileTeamsMessagesInput {
  return {
    orgId: ORG,
    ownerUserId: OWNER,
    ownerEmail: 'tony@mantu.com',
    actorUserId: OWNER,
    companyId: ACME,
    opportunityId: null,
    thread: {
      ref: { kind: 'chat', chatId: '19:acme@thread.v2' },
      title: 'Chat with Jane Doe',
      members: [
        { aadUserId: 'aad-tony', email: 'tony@mantu.com', displayName: 'Tony' },
        { aadUserId: 'aad-jane', email: 'jane@acme.com', displayName: 'Jane Doe' },
        { aadUserId: 'aad-bob', email: 'bob@acme.com', displayName: 'Bob' },
      ],
    },
    messages: [msg()],
    ...over,
  };
}

describe('teams thread helpers', () => {
  it('keys a chat and a channel thread', () => {
    expect(teamsThreadKey({ kind: 'chat', chatId: 'c' })).toBe('chat:c');
    expect(teamsThreadKey({ kind: 'channel_thread', teamId: 't', channelId: 'c', messageId: 'm' })).toBe(
      'channel:t:c:m',
    );
  });

  it('titles a chat by topic, else by the other members', () => {
    const members = [
      { aadUserId: '1', email: 'tony@mantu.com', displayName: 'Tony' },
      { aadUserId: '2', email: 'jane@acme.com', displayName: 'Jane' },
    ];
    expect(teamsThreadTitle('Acme RFP', members, 'tony@mantu.com')).toBe('Acme RFP');
    expect(teamsThreadTitle(null, members, 'tony@mantu.com')).toBe('Chat with Jane');
    expect(teamsThreadTitle(null, [], null)).toBe('Teams chat');
  });

  it('keeps the dedupe key inside the 128 char column', () => {
    expect(teamsActivityKey(ORG, 'x'.repeat(300)).length).toBeLessThanOrEqual(128);
  });
});

describe('fileTeamsMessages', () => {
  it('creates one teams_message activity with link, author, attachment names and attendees', async () => {
    const { t, svc } = fixture();
    const res = await svc.fileMessages(input());
    expect(res).toMatchObject({ created: 1, updated: 0, skipped: 0, alreadyFiled: 0 });
    const act = t.activity.rows[0]!;
    expect(act).toMatchObject({
      type: 'teams_message',
      subject: 'Chat with Jane Doe',
      description: 'Can we review the RFP scope Friday?',
      entityType: 'company',
      entityId: ACME,
      actorId: OWNER,
      actorType: 'user',
      idempotencyKey: teamsActivityKey(ORG, 'm1'),
    });
    const meta = (act.metadata as { commsCapture: Record<string, unknown> }).commsCapture;
    expect(meta).toMatchObject({
      source: 'teams',
      sourceType: 'teams_message',
      sourceId: 'm1',
      direction: 'inbound',
      participantCount: 3,
      filedManually: true,
      teams: { webUrl: 'https://teams.microsoft.com/l/message/19%3Aacme/m1', attachmentNames: ['Scope v2.docx'] },
    });
    const att = t.activityAttendee.rows;
    expect(att.find((a) => a.contactId === CONTACT)).toBeTruthy();
    expect(att.find((a) => a.userId === OWNER)).toBeTruthy();
    expect(att.find((a) => a.email === 'bob@acme.com')).toBeTruthy();
    expect(res.watermark?.toISOString()).toBe('2026-11-07T15:00:00.000Z');
  });

  it('dedupes by Graph message id: a second import updates the same row', async () => {
    const { t, svc } = fixture();
    await svc.fileMessages(input());
    const again = await svc.fileMessages(input({ messages: [msg({ text: 'edited' })] }));
    expect(again).toMatchObject({ created: 0, updated: 1 });
    expect(t.activity.rows).toHaveLength(1);
    expect(t.activity.rows[0]!.description).toBe('edited');
  });

  it('leaves a message another person filed to another account where it is', async () => {
    const { t, svc } = fixture();
    await svc.fileMessages(input({ ownerUserId: COLLEAGUE, actorUserId: COLLEAGUE, ownerEmail: 'sam@mantu.com' }));
    const res = await svc.fileMessages(input({ companyId: GLOBEX }));
    expect(res).toMatchObject({ alreadyFiled: 1, created: 0, updated: 0 });
    expect(t.activity.rows[0]!.entityId).toBe(ACME);
  });

  it('lets the person who filed a message move it, and alerts the new account', async () => {
    const { svc, t } = fixture();
    await svc.fileMessages(input());
    const digests: AccountActivityDigest[] = [];
    const off = subscribeAccountActivityDigest((d) => {
      digests.push(d);
    });
    try {
      const res = await svc.fileMessages(input({ companyId: GLOBEX }));
      expect(res.updated).toBe(1);
    } finally {
      off();
    }
    expect(t.activity.rows[0]!.entityId).toBe(GLOBEX);
    expect(digests.map((d) => d.companyId)).toEqual([GLOBEX]);
  });

  it('skips system events and soft-deletes a message deleted in Teams', async () => {
    const { t, svc } = fixture();
    await svc.fileMessages(input());
    const res = await svc.fileMessages(
      input({
        actorUserId: null,
        messages: [msg({ id: 'sys', messageType: 'systemEventMessage' }), msg({ deletedAt: '2026-11-07T16:00:00Z' })],
      }),
    );
    expect(res).toMatchObject({ skipped: 1, removed: 1 });
    expect(t.activity.rows[0]!.deletedAt).toBeInstanceOf(Date);
    expect(t.activity.rows[0]!.description).toBeNull();
  });

  it('does not bring back a row a person deleted on sync, but does on an explicit import', async () => {
    const { t, svc } = fixture();
    await svc.fileMessages(input());
    t.activity.rows[0]!.deletedAt = new Date();
    expect((await svc.fileMessages(input({ actorUserId: null }))).skipped).toBe(1);
    expect(t.activity.rows[0]!.deletedAt).toBeInstanceOf(Date);
    expect((await svc.fileMessages(input())).created).toBe(1);
    expect(t.activity.rows[0]!.deletedAt).toBeNull();
    expect(t.activity.rows).toHaveLength(1);
  });

  it('keeps who filed it when the sync worker refreshes the text', async () => {
    const { t, svc } = fixture();
    await svc.fileMessages(input());
    await svc.fileMessages(input({ actorUserId: null, messages: [msg({ text: 'later edit' })] }));
    expect(t.activity.rows[0]).toMatchObject({ actorId: OWNER, actorType: 'user', description: 'later edit' });
  });

  it('raises one digest per account for a batch, never alerting the people in the chat', async () => {
    const { svc } = fixture();
    const digests: AccountActivityDigest[] = [];
    const off = subscribeAccountActivityDigest((d) => {
      digests.push(d);
    });
    try {
      await runAccountActivityBatch(() =>
        svc.fileMessages(input({ messages: [msg({ id: 'a' }), msg({ id: 'b' }), msg({ id: 'c' })] })),
      );
    } finally {
      off();
    }
    expect(digests).toHaveLength(1);
    expect(digests[0]!.activityIds).toHaveLength(3);
    expect(digests[0]!.excludeUserIds).toContain(OWNER);
    expect(digests[0]!.actorUserId).toBe(OWNER);
  });

  it('files to an opportunity when one is given', async () => {
    const { t, svc } = fixture();
    const opp = '00000000-0000-4000-8000-000000000030';
    await svc.fileMessages(input({ opportunityId: opp }));
    expect(t.activity.rows[0]).toMatchObject({ entityType: 'opportunity', entityId: opp });
  });

  it('reports filed message ids for the picker', async () => {
    const { svc } = fixture();
    await svc.fileMessages(input());
    expect([...(await svc.filedMessageIds(ORG, ['m1', 'm2']))]).toEqual(['m1']);
  });
});

describe('suggestTeamsAccounts', () => {
  it('ranks a known contact first, then a company domain, and ignores colleagues', async () => {
    const { svc } = fixture();
    const out = await svc.suggestAccounts({
      orgId: ORG,
      ownerEmail: 'tony@mantu.com',
      emails: ['sam@mantu.com', 'ops@globex.io', 'jane@acme.com', 'friend@gmail.com'],
    });
    expect(out.map((s) => [s.name, s.reason, s.match])).toEqual([
      ['Acme', 'contact', 'jane@acme.com'],
      ['Globex', 'domain', 'globex.io'],
    ]);
  });

  it('matches a subdomain to the account domain', async () => {
    const { svc } = fixture();
    const out = await svc.suggestAccounts({ orgId: ORG, ownerEmail: null, emails: ['it@eu.globex.io'] });
    expect(out[0]).toMatchObject({ companyId: GLOBEX, reason: 'domain' });
  });

  it('never suggests an account outside the caller access scope', async () => {
    const { svc } = fixture();
    const out = await svc.suggestAccounts({ orgId: ORG, ownerEmail: null, emails: ['a@hidden.co'] });
    expect(out).toHaveLength(1);
    const scoped = await svc.suggestAccounts({
      orgId: ORG,
      ownerEmail: null,
      emails: ['a@hidden.co'],
      companyWhere: { id: { in: [ACME] } },
    });
    expect(scoped).toEqual([]);
  });

  it('returns nothing for an internal-only chat', async () => {
    const { svc } = fixture();
    expect(await svc.suggestAccounts({ orgId: ORG, ownerEmail: 'tony@mantu.com', emails: ['sam@mantu.com'] })).toEqual(
      [],
    );
  });
});
