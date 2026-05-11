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
import { Note, NoteCreate, NotePatch } from '@bidstack/shared';

import { buildServer } from '../server.js';

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
});

// ─── In-process integration ───────────────────────────────────────────────

let server: Awaited<ReturnType<typeof buildServer>>;
let dbReachable = false;

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    dbReachable = false;
    return;
  }
  server = await buildServer();
  await server.ready();
});

afterAll(async () => {
  if (server) await server.close();
  if (dbReachable) await prisma.$disconnect();
});

const skipIfNoDb = (name: string, fn: () => Promise<void> | void) =>
  it(name, async () => {
    if (!dbReachable) {
      // Surface the skip — silent skips violate Rule 12 (Fail loud).
      console.warn(`[skip] ${name} — DATABASE_URL not reachable`);
      return;
    }
    await fn();
  });

describe('notes routes (integration)', () => {
  const accountId = `test-account-${Date.now()}`;

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
});
