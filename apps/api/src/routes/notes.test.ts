// Notes route tests.
// Why this file exists: notes are the first cockpit-side write surface, so
// the contract (Zod validation + multi-tenancy) must be exercised, not just
// asserted in TypeScript. We keep the suite split in two:
//
//   1. Schema contract tests — pure (no DB / no Fastify), assert the Zod
//      shapes reject the wrong-shaped payloads we'd silently accept if a
//      future change loosened them.
//
//   2. In-process integration test — boots Fastify with the real auth stub
//      and Prisma client, hits /api/notes via server.inject. Skipped when
//      DATABASE_URL isn't reachable so the suite stays green in offline CI.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '@bidstack/db';
import { MeetingNotesImportRequest, Note, NoteCreate, NotePatch } from '@bidstack/shared';

import { buildServer } from '../server.js';
import { makeSkipIfNoDb } from '../test-support/skip-if-no-db.js';

describe('Note schemas', () => {
  it('Note rejects an empty title — title is the only inline-listable field', () => {
    // Why this matters: the cockpit panel renders title in semibold as the
    // primary handle for each row. An empty title would render as a blank
    // row that looks broken. The DB column is also NOT NULL.
    const base = {
      id: '00000000-0000-4000-8000-000000000001',
      accountId: 'mantu',
      bodyMd: 'hello',
      pinned: false,
      authorUserId: '00000000-0000-4000-8000-000000000002',
      authorEmail: 'tony@example.com',
      createdAt: '2026-05-11T00:00:00.000Z',
      updatedAt: '2026-05-11T00:00:00.000Z',
    };
    expect(() => Note.parse({ ...base, title: '' })).toThrow();
    expect(() => Note.parse({ ...base, title: 'ok' })).not.toThrow();
  });

  it('NoteCreate defaults pinned=false so the form can omit it', () => {
    // Why this matters: the inline editor in NotesPanel only exposes title +
    // body. If the schema didn't default pinned, every new note would 400
    // unless the client added the field — silent UX breakage.
    const parsed = NoteCreate.parse({
      accountId: 'mantu',
      title: 'Kickoff',
      bodyMd: 'discovery call',
    });
    expect(parsed.pinned).toBe(false);
  });

  it('NotePatch rejects an empty body — PATCH with no fields is a client bug', () => {
    // Why this matters: an empty PATCH would issue a no-op UPDATE that still
    // bumps updated_at and creates audit noise. Better to surface it as 400.
    expect(() => NotePatch.parse({})).toThrow();
    expect(() => NotePatch.parse({ pinned: true })).not.toThrow();
  });

  it('MeetingNotesImportRequest requires real note content before extraction', () => {
    // Why: this endpoint creates contacts, risks, tasks, and company stack
    // facts. Accidental tiny pastes should fail before they mutate CRM state.
    expect(() =>
      MeetingNotesImportRequest.parse({
        accountId: 'mantu',
        companyName: 'Mantu',
        bodyMd: 'short',
      }),
    ).toThrow();
    expect(() =>
      MeetingNotesImportRequest.parse({
        accountId: 'mantu',
        companyName: 'Mantu',
        bodyMd: 'Tech stack: Azure and Okta. Action: follow up.',
      }),
    ).not.toThrow();
  });
});

// ─── In-process integration ───────────────────────────────────────────────

let server: Awaited<ReturnType<typeof buildServer>>;
let dbReachable = false;

async function cleanupMeetingImportArtifacts(): Promise<void> {
  const now = new Date();
  await prisma.$transaction([
    prisma.contact.updateMany({
      where: {
        deletedAt: null,
        OR: [
          { name: 'E2E Buyer' },
          { name: { startsWith: 'Attendees:' } },
          { name: { startsWith: 'Risk:' } },
          { customer: { startsWith: 'Meeting Import' } },
        ],
      },
      data: { deletedAt: now },
    }),
    prisma.note.updateMany({
      where: { deletedAt: null, accountId: { startsWith: 'meeting import ' } },
      data: { deletedAt: now },
    }),
    prisma.riskRegisterItem.updateMany({
      where: { deletedAt: null, companyName: { startsWith: 'Meeting Import' } },
      data: { deletedAt: now },
    }),
    prisma.task.updateMany({
      where: { deletedAt: null, title: { startsWith: 'Send Jamf deployment plan' } },
      data: { deletedAt: now },
    }),
    prisma.companyEnrichment.updateMany({
      where: { deletedAt: null, normalizedName: { startsWith: 'meeting-import-' } },
      data: { deletedAt: now },
    }),
  ]);
}

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    dbReachable = false;
    return;
  }
  await cleanupMeetingImportArtifacts();
  server = await buildServer();
  await server.ready();
});

afterAll(async () => {
  if (server) await server.close();
  if (dbReachable) {
    await cleanupMeetingImportArtifacts();
    await prisma.$disconnect();
  }
});

const skipIfNoDb = makeSkipIfNoDb(() => dbReachable);

describe('notes routes (integration)', () => {
  const accountId = `test-account-${Date.now()}`;

  skipIfNoDb('POST stores the company id when the account tag is that company', async () => {
    // WHY: the cockpit saves a note with the company id in accountId and no
    // companyId. A later read by company id missed it, and a note already
    // linked by companyId was invisible when its label differed.
    const probe = await server.inject({
      method: 'POST',
      url: '/api/notes',
      payload: { accountId: `probe-${Date.now()}`, title: 'Probe', bodyMd: 'org' },
    });
    expect(probe.statusCode).toBe(201);
    const probeId = (probe.json() as { id: string }).id;
    const probeRow = await prisma.note.findUnique({ where: { id: probeId }, select: { orgId: true } });
    const company = await prisma.company.create({
      data: { orgId: probeRow!.orgId, name: `Note Co ${Date.now()}` },
    });
    const created = await server.inject({
      method: 'POST',
      url: '/api/notes',
      payload: { accountId: company.id.toUpperCase(), title: 'On the account', bodyMd: 'linked' },
    });
    expect(created.statusCode).toBe(201);
    const note = created.json() as { id: string; companyId?: string };
    expect(note.companyId).toBe(company.id);

    const labeled = await prisma.note.create({
      data: {
        orgId: probeRow!.orgId,
        accountId: `label-${Date.now()}`,
        companyId: company.id,
        authorUserId: (await prisma.note.findUnique({ where: { id: note.id }, select: { authorUserId: true } }))!
          .authorUserId,
        title: 'Labeled',
        bodyMd: 'already linked',
      },
    });

    const list = await server.inject({
      method: 'GET',
      url: `/api/notes?accountId=${company.id}`,
    });
    expect(list.statusCode).toBe(200);
    const ids = (list.json() as { items: Array<{ id: string }> }).items.map((item) => item.id);
    expect(ids).toContain(note.id);
    expect(ids).toContain(labeled.id);

    await prisma.note.deleteMany({ where: { id: { in: [probeId, note.id, labeled.id] } } });
    await prisma.company.delete({ where: { id: company.id } });
  });

  skipIfNoDb('POST → GET → PATCH → DELETE round-trips a note', async () => {
    const created = await server.inject({
      method: 'POST',
      url: '/api/notes',
      payload: { accountId, title: 'Kickoff', bodyMd: 'discovery call' },
    });
    expect(created.statusCode).toBe(201);
    const note = created.json() as { id: string; pinned: boolean };
    expect(note.pinned).toBe(false);

    const list = await server.inject({
      method: 'GET',
      url: `/api/notes?accountId=${encodeURIComponent(accountId)}`,
    });
    expect(list.statusCode).toBe(200);
    expect((list.json() as { items: unknown[] }).items.length).toBeGreaterThanOrEqual(1);

    const patched = await server.inject({
      method: 'PATCH',
      url: `/api/notes/${note.id}`,
      payload: { pinned: true },
    });
    expect(patched.statusCode).toBe(200);
    expect((patched.json() as { pinned: boolean }).pinned).toBe(true);

    const deleted = await server.inject({
      method: 'DELETE',
      url: `/api/notes/${note.id}`,
    });
    expect(deleted.statusCode).toBe(204);
  });

  skipIfNoDb('GET requires accountId — unscoped lists would leak across accounts', async () => {
    // Why: omitting accountId would 400 because the cockpit panel is the
    // only consumer and it always knows the account. A future "all notes"
    // view should add an explicit endpoint with its own auth gate.
    const res = await server.inject({ method: 'GET', url: '/api/notes' });
    expect(res.statusCode).toBe(400);
  });

  skipIfNoDb('POST import-meeting turns raw notes into CRM records and company stack', async () => {
    const companyName = `Meeting Import ${Date.now()}`;
    const normalizedName = companyName.toLowerCase().replaceAll(' ', '-');
    const bodyMd = [
      'Attendees: Jane Doe - IT Security Manager, jane.import@example.com',
      'Tech stack: Azure, Okta, CrowdStrike, Jamf Pro, Salesforce',
      'Compliance: ISO 27001 complete, SOC 2 in progress',
      'Risk: High concern around endpoint migration timing. Owner: Jane',
      'Risk: Endpoint migration timing is unclear',
      'Action: Send Jamf deployment plan by 2026-06-15',
    ].join('\n');

    const res = await server.inject({
      method: 'POST',
      url: '/api/notes/import-meeting',
      payload: {
        accountId: companyName,
        companyName,
        domain: 'meeting-import.example',
        bodyMd,
      },
    });
    expect(res.statusCode).toBe(201);
    const json = res.json() as {
      extracted: {
        techStack: Array<{ label: string; items: Array<{ name: string }> }>;
        contacts: unknown[];
        risks: Array<{ title: string; severity: string | null }>;
        compliance: Array<{ label: string; status: string | null }>;
        tasks: unknown[];
      };
      created: { techStackItems: number };
    };
    const vendors = json.extracted.techStack.flatMap((category) =>
      category.items.map((item) => item.name),
    );
    expect(vendors).toEqual(expect.arrayContaining(['Azure', 'Okta', 'CrowdStrike', 'Jamf Pro']));
    expect(json.extracted.contacts.length).toBeGreaterThanOrEqual(1);
    expect(json.extracted.risks.length).toBeGreaterThanOrEqual(1);
    const unranked = json.extracted.risks.find((risk) => /unclear/i.test(risk.title));
    expect(unranked?.severity).toBeNull();
    const stored = await prisma.riskRegisterItem.findMany({
      where: { companyName },
      select: { title: true, severity: true },
    });
    expect(stored.some((row) => /security manager/i.test(row.title))).toBe(false);
    expect(stored.find((row) => /unclear/i.test(row.title))?.severity).toBe('unspecified');
    expect(stored.find((row) => /high concern/i.test(row.title))?.severity).toBe('high');
    expect(json.extracted.compliance.length).toBeGreaterThanOrEqual(2);
    const compliance = new Map(json.extracted.compliance.map((check) => [check.label, check.status]));
    expect(compliance.get('ISO 27001')).toBe('compliant');
    expect(compliance.get('SOC 2')).toBe('in_progress');
    expect(json.extracted.tasks.length).toBeGreaterThanOrEqual(1);
    expect(json.created.techStackItems).toBeGreaterThanOrEqual(4);

    const enrichment = await prisma.companyEnrichment.findFirst({
      where: { normalizedName },
      select: { providerMetadata: true },
    });
    expect(enrichment).not.toBeNull();
    expect(JSON.stringify(enrichment?.providerMetadata)).toContain('meetingTechStack');
    expect(JSON.stringify(enrichment?.providerMetadata)).toContain('CrowdStrike');
  });

  skipIfNoDb('POST import-meeting links people and tasks when one company matches', async () => {
    // WHY: imported people were stored under the company name only. Dust
    // listing the account by id never saw them. A guessed role word in the
    // name ("Buyer") is not an influence score or a warm/cold temperature.
    const stamp = Date.now();
    const probe = await server.inject({
      method: 'POST',
      url: '/api/notes',
      payload: { accountId: `probe-import-${stamp}`, title: 'Probe', bodyMd: 'org' },
    });
    expect(probe.statusCode).toBe(201);
    const probeId = (probe.json() as { id: string }).id;
    const probeRow = await prisma.note.findUnique({ where: { id: probeId }, select: { orgId: true } });
    const companyName = `Linked Import ${stamp}`;
    const company = await prisma.company.create({
      data: { orgId: probeRow!.orgId, name: companyName },
    });
    const email = `linked.${stamp}@example.com`;
    const taskTitle = `Send linked plan ${stamp} by 2026-06-15`;
    const res = await server.inject({
      method: 'POST',
      url: '/api/notes/import-meeting',
      payload: {
        accountId: companyName,
        companyName,
        bodyMd: [
          `Attendees: Linked Buyer ${stamp} - IT Security Manager, ${email}`,
          `Action: ${taskTitle}`,
          'Tech stack: Azure',
        ].join('\n'),
      },
    });
    expect(res.statusCode).toBe(201);
    const contact = await prisma.contact.findFirst({
      where: { orgId: probeRow!.orgId, email },
      select: { id: true, companyId: true, influence: true, sentiment: true },
    });
    const task = await prisma.task.findFirst({
      where: { orgId: probeRow!.orgId, title: taskTitle },
      select: { id: true, accountId: true },
    });
    expect(contact?.companyId).toBe(company.id);
    expect(contact?.influence).toBeNull();
    expect(contact?.sentiment).toBeNull();
    expect(task?.accountId).toBe(company.id);
    if (contact) await prisma.contact.delete({ where: { id: contact.id } });
    if (task) await prisma.task.delete({ where: { id: task.id } });
    await prisma.companyEnrichment.deleteMany({
      where: {
        orgId: probeRow!.orgId,
        normalizedName: companyName.toLowerCase().replaceAll(' ', '-'),
      },
    });
    await prisma.note.deleteMany({ where: { orgId: probeRow!.orgId, accountId: companyName.toLowerCase() } });
    await prisma.note.delete({ where: { id: probeId } });
    await prisma.company.delete({ where: { id: company.id } });
  });

  skipIfNoDb('POST import-meeting keeps another company and a blank re-import off the row', async () => {
    // WHY: compliance was matched by framework label alone. A note for one
    // company rewrote another company's status, and a later note with no
    // owner cleared the owner.
    const stamp = Date.now();
    const probe = await server.inject({
      method: 'POST',
      url: '/api/notes',
      payload: { accountId: `probe-compliance-${stamp}`, title: 'Probe', bodyMd: 'org' },
    });
    expect(probe.statusCode).toBe(201);
    const probeId = (probe.json() as { id: string }).id;
    const probeRow = await prisma.note.findUnique({ where: { id: probeId }, select: { orgId: true } });
    const orgId = probeRow!.orgId;
    const otherName = `Other Compliance ${stamp}`;
    const companyName = `Fresh Compliance ${stamp}`;
    const other = await prisma.complianceCheck.create({
      data: {
        orgId,
        label: 'GDPR',
        status: 'compliant',
        owner: 'Ada',
        sourceAttribution: [
          {
            source: 'meeting_notes_import',
            label: 'Meeting notes import',
            sourceUrl: null,
            fetchedAt: new Date().toISOString(),
            confidence: null,
            providerMetadata: { companyName: otherName },
          },
        ],
      },
    });
    const first = await server.inject({
      method: 'POST',
      url: '/api/notes/import-meeting',
      payload: {
        accountId: companyName,
        companyName,
        bodyMd: 'Compliance: GDPR not started. Owner: Bea',
      },
    });
    expect(first.statusCode).toBe(201);
    const second = await server.inject({
      method: 'POST',
      url: '/api/notes/import-meeting',
      payload: {
        accountId: companyName,
        companyName,
        bodyMd: 'Compliance: GDPR was mentioned again',
      },
    });
    expect(second.statusCode).toBe(201);
    const rows = await prisma.complianceCheck.findMany({
      where: { orgId, label: 'GDPR', deletedAt: null },
      select: { id: true, status: true, owner: true, sourceAttribution: true },
    });
    const companyOf = (value: unknown) => {
      if (!Array.isArray(value)) return null;
      const meta = (value[0] as { providerMetadata?: { companyName?: string } } | undefined)
        ?.providerMetadata?.companyName;
      return typeof meta === 'string' ? meta : null;
    };
    const kept = rows.find((row) => row.id === other.id);
    const fresh = rows.find((row) => companyOf(row.sourceAttribution) === companyName);
    expect(kept?.status).toBe('compliant');
    expect(kept?.owner).toBe('Ada');
    expect(fresh?.status).toBe('not_started');
    expect(fresh?.owner).toBe('Bea');
    await prisma.complianceCheck.deleteMany({
      where: { orgId, label: 'GDPR', id: { in: rows.map((row) => row.id) } },
    });
    await prisma.note.deleteMany({
      where: { orgId, accountId: { in: [companyName.toLowerCase(), `probe-compliance-${stamp}`] } },
    });
  });

  skipIfNoDb('POST import-meeting keeps a follow-up when another account has the same title', async () => {
    // WHY: task dedupe was the title alone. Company B's action was dropped
    // because company A already had those words.
    const stamp = Date.now();
    const probe = await server.inject({
      method: 'POST',
      url: '/api/notes',
      payload: { accountId: `probe-task-${stamp}`, title: 'Probe', bodyMd: 'org' },
    });
    expect(probe.statusCode).toBe(201);
    const probeId = (probe.json() as { id: string }).id;
    const probeRow = await prisma.note.findUnique({ where: { id: probeId }, select: { orgId: true } });
    const orgId = probeRow!.orgId;
    const otherName = `Other Tasks ${stamp}`;
    const companyName = `Fresh Tasks ${stamp}`;
    const other = await prisma.company.create({ data: { orgId, name: otherName } });
    const fresh = await prisma.company.create({ data: { orgId, name: companyName } });
    const title = `Send the shared plan ${stamp} by 2026-06-15`;
    const existing = await prisma.task.create({
      data: { orgId, accountId: other.id, title, status: 'open' },
    });
    const payload = {
      accountId: companyName,
      companyName,
      bodyMd: `Action: ${title}`,
    };
    const first = await server.inject({ method: 'POST', url: '/api/notes/import-meeting', payload });
    expect(first.statusCode).toBe(201);
    const second = await server.inject({ method: 'POST', url: '/api/notes/import-meeting', payload });
    expect(second.statusCode).toBe(201);
    const tasks = await prisma.task.findMany({
      where: { orgId, title, deletedAt: null },
      select: { id: true, accountId: true },
    });
    expect(tasks.map((task) => task.accountId).sort()).toEqual([other.id, fresh.id].sort());
    expect(tasks.filter((task) => task.accountId === fresh.id)).toHaveLength(1);
    expect(tasks.some((task) => task.id === existing.id)).toBe(true);
    await prisma.task.deleteMany({ where: { orgId, title } });
    await prisma.companyEnrichment.deleteMany({
      where: { orgId, normalizedName: companyName.toLowerCase().replaceAll(' ', '-') },
    });
    await prisma.note.deleteMany({
      where: { orgId, accountId: { in: [companyName.toLowerCase(), `probe-task-${stamp}`] } },
    });
    await prisma.company.deleteMany({ where: { id: { in: [other.id, fresh.id] } } });
  });

  skipIfNoDb('POST import-meeting adds a same-named person on another company', async () => {
    // WHY: dedupe was name or email across the org. Jane at company A hid
    // Jane at company B, and an email with no company never picked up the link.
    const stamp = Date.now();
    const probe = await server.inject({
      method: 'POST',
      url: '/api/notes',
      payload: { accountId: `probe-people-${stamp}`, title: 'Probe', bodyMd: 'org' },
    });
    expect(probe.statusCode).toBe(201);
    const probeId = (probe.json() as { id: string }).id;
    const probeRow = await prisma.note.findUnique({ where: { id: probeId }, select: { orgId: true } });
    const orgId = probeRow!.orgId;
    const otherName = `Other People ${stamp}`;
    const companyName = `Fresh People ${stamp}`;
    const other = await prisma.company.create({ data: { orgId, name: otherName } });
    const fresh = await prisma.company.create({ data: { orgId, name: companyName } });
    const sharedName = `Jane Shared ${stamp}`;
    const otherEmail = `other.${stamp}@example.com`;
    const freshEmail = `fresh.${stamp}@example.com`;
    const unlinkedEmail = `unlinked.${stamp}@example.com`;
    const kept = await prisma.contact.create({
      data: { orgId, customer: otherName, companyId: other.id, name: sharedName, email: otherEmail },
    });
    const unlinked = await prisma.contact.create({
      data: { orgId, customer: 'Unknown', name: `Unlinked ${stamp}`, email: unlinkedEmail },
    });
    const payload = {
      accountId: companyName,
      companyName,
      bodyMd: [
        `Attendees: ${sharedName} - CFO, ${freshEmail}`,
        `Attendees: Unlinked ${stamp} - Finance, ${unlinkedEmail}`,
      ].join('\n'),
    };
    const first = await server.inject({ method: 'POST', url: '/api/notes/import-meeting', payload });
    expect(first.statusCode).toBe(201);
    const second = await server.inject({ method: 'POST', url: '/api/notes/import-meeting', payload });
    expect(second.statusCode).toBe(201);
    const rows = await prisma.contact.findMany({
      where: { orgId, email: { in: [otherEmail, freshEmail, unlinkedEmail] }, deletedAt: null },
      select: { id: true, email: true, companyId: true },
    });
    const byEmail = new Map(rows.map((row) => [row.email?.toLowerCase(), row]));
    expect(byEmail.get(otherEmail)?.id).toBe(kept.id);
    expect(byEmail.get(otherEmail)?.companyId).toBe(other.id);
    expect(byEmail.get(freshEmail)?.companyId).toBe(fresh.id);
    expect(rows.filter((row) => row.email?.toLowerCase() === freshEmail)).toHaveLength(1);
    expect(byEmail.get(unlinkedEmail)?.id).toBe(unlinked.id);
    expect(byEmail.get(unlinkedEmail)?.companyId).toBe(fresh.id);
    await prisma.contact.deleteMany({ where: { orgId, id: { in: rows.map((row) => row.id) } } });
    await prisma.companyEnrichment.deleteMany({
      where: { orgId, normalizedName: companyName.toLowerCase().replaceAll(' ', '-') },
    });
    await prisma.note.deleteMany({
      where: { orgId, accountId: { in: [companyName.toLowerCase(), `probe-people-${stamp}`] } },
    });
    await prisma.company.deleteMany({ where: { id: { in: [other.id, fresh.id] } } });
  });

  skipIfNoDb('POST import-meeting records a risk again after the old row is deleted', async () => {
    // WHY: dedupe ignored deleted rows. A removed risk with the same title
    // blocked the note from recording it again.
    const stamp = Date.now();
    const probe = await server.inject({
      method: 'POST',
      url: '/api/notes',
      payload: { accountId: `probe-risk-${stamp}`, title: 'Probe', bodyMd: 'org' },
    });
    expect(probe.statusCode).toBe(201);
    const probeId = (probe.json() as { id: string }).id;
    const probeRow = await prisma.note.findUnique({ where: { id: probeId }, select: { orgId: true } });
    const orgId = probeRow!.orgId;
    const companyName = `Risk Again ${stamp}`;
    const title = `Cutover timing ${stamp} is unclear`;
    const removed = await prisma.riskRegisterItem.create({
      data: {
        orgId,
        companyName,
        title,
        severity: 'high',
        status: 'open',
        deletedAt: new Date(),
      },
    });
    const payload = {
      accountId: companyName,
      companyName,
      bodyMd: `Risk: ${title}`,
    };
    const first = await server.inject({ method: 'POST', url: '/api/notes/import-meeting', payload });
    expect(first.statusCode).toBe(201);
    const second = await server.inject({ method: 'POST', url: '/api/notes/import-meeting', payload });
    expect(second.statusCode).toBe(201);
    const live = await prisma.riskRegisterItem.findMany({
      where: { orgId, companyName, title, deletedAt: null },
      select: { id: true },
    });
    expect(live).toHaveLength(1);
    expect(live[0]?.id).not.toBe(removed.id);
    await prisma.riskRegisterItem.deleteMany({ where: { orgId, companyName, title } });
    await prisma.companyEnrichment.deleteMany({
      where: { orgId, normalizedName: companyName.toLowerCase().replaceAll(' ', '-') },
    });
    await prisma.note.deleteMany({
      where: { orgId, accountId: { in: [companyName.toLowerCase(), `probe-risk-${stamp}`] } },
    });
  });
});
