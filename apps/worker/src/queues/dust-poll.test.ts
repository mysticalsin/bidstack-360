// Unit tests for dust-poll's per-org sync loop (pollOrgDust) and the org
// fanout cursor pagination (fanoutOrgPolls). getOrgDust, the dust-sync-helpers
// upserts, and prisma are all mocked, so these exercise dust-poll.ts's OWN
// routing/telemetry/pagination logic in isolation — the Dust → CRM mapping
// logic itself is covered by dust-sync-helpers.test.ts.
//
// pollOrgDust/fanoutOrgPolls were made `export`ed (previously module-private)
// solely so this suite can call them directly, mirroring how
// calendar-sync-microsoft.ts already exports its per-item handlers for unit
// testing instead of only being reachable through a live BullMQ Worker. The
// per-org circuit-breaker helpers (pollOrgDustWithBreaker & co) are exported
// for the same reason.
import type { Queue } from 'bullmq';
import type pino from 'pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  syncEventCreate: vi.fn(),
  orgFindMany: vi.fn(),
  orgFindUnique: vi.fn(),
  getOrgDust: vi.fn(),
  upsertOpportunityFromDust: vi.fn(),
  upsertCompanyFromDust: vi.fn(),
  upsertNoteFromDust: vi.fn(),
  upsertLeadFromDust: vi.fn(),
}));

vi.mock('@bidstack/db', () => ({
  prisma: {
    syncEvent: { create: mocks.syncEventCreate },
    org: { findMany: mocks.orgFindMany, findUnique: mocks.orgFindUnique },
  },
}));

vi.mock('../lib/dust-credentials.js', () => ({
  getOrgDust: mocks.getOrgDust,
}));

vi.mock('./dust-sync-helpers.js', () => ({
  upsertOpportunityFromDust: mocks.upsertOpportunityFromDust,
  upsertCompanyFromDust: mocks.upsertCompanyFromDust,
  upsertNoteFromDust: mocks.upsertNoteFromDust,
  upsertLeadFromDust: mocks.upsertLeadFromDust,
}));

import {
  fanoutOrgPolls,
  isDustCircuitOpen,
  pollOrgDust,
  pollOrgDustWithBreaker,
  recordDustPollFailure,
  resetDustCircuitBreakerForTest,
} from './dust-poll.js';

const ORG_A = '00000000-0000-4000-8000-000000000001';
const ORG_B = '00000000-0000-4000-8000-000000000002';

const logImpl = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  child: vi.fn(),
};
logImpl.child.mockReturnValue(logImpl);
const log = logImpl as unknown as pino.Logger;

afterEach(() => {
  vi.clearAllMocks();
  logImpl.child.mockReturnValue(logImpl);
  vi.useRealTimers();
});

beforeEach(() => {
  // Default: the tenant still exists. pollOrgDust short-circuits when it does
  // not, so every other case has to opt in to a live org.
  mocks.orgFindUnique.mockResolvedValue({ id: ORG_A });
});

describe('pollOrgDust', () => {
  it('drops the job when the org no longer exists instead of violating the FK forever', async () => {
    // A queued job can outlive its tenant (offboarding, or a dropped test org).
    // The stub sync_event write then violates sync_events_org_id_fkey, BullMQ
    // retries, and the same Prisma error repeats indefinitely — observed in the
    // dev worker log as 54 identical FK errors from jobs whose org was gone.
    mocks.orgFindUnique.mockResolvedValue(null);

    await pollOrgDust(ORG_A, log);

    expect(mocks.syncEventCreate).not.toHaveBeenCalled();
    expect(mocks.getOrgDust).not.toHaveBeenCalled();
  });

  it('writes a stub sync_event and never touches Dust when the org has no credentials configured', async () => {
    mocks.getOrgDust.mockResolvedValue({ client: null, creds: null });

    await pollOrgDust(ORG_A, log);

    expect(mocks.syncEventCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        orgId: ORG_A,
        source: 'dust.poll',
        eventType: 'tick.stub',
        status: 'processed',
      }),
    });
  });

  it('routes each doc by metadata to the matching upsert helper, org-scoped, and tallies a completed sync_event', async () => {
    const dustClient = {
      listDocuments: vi.fn().mockResolvedValue([
        { document_id: 'doc-opp' },
        { document_id: 'doc-lead' },
        { document_id: 'doc-company' },
        { document_id: 'doc-note' },
      ]),
      getDocument: vi.fn().mockImplementation(async (_ds: string, id: string) => {
        switch (id) {
          case 'doc-opp':
            return { document_id: id, metadata: { opportunity_code: 'OPP-1' } };
          case 'doc-lead':
            return { document_id: id, metadata: { lead_email: 'a@b.com' } };
          case 'doc-company':
            return { document_id: id, metadata: { company_name: 'Acme' } };
          default:
            return { document_id: id, metadata: {} };
        }
      }),
    };
    mocks.getOrgDust.mockResolvedValue({ client: dustClient, creds: { dataSourceId: 'ds-1' } });
    mocks.upsertOpportunityFromDust.mockResolvedValue({ id: 'opp-1', created: true, skipped: false });
    mocks.upsertLeadFromDust.mockResolvedValue({ id: 'lead-1', created: true, skipped: false });
    mocks.upsertCompanyFromDust.mockResolvedValue({ id: 'ce-1', created: true });
    mocks.upsertNoteFromDust.mockResolvedValue({ id: 'note-1', created: true });

    await pollOrgDust(ORG_A, log);

    expect(mocks.upsertOpportunityFromDust).toHaveBeenCalledWith(
      ORG_A,
      expect.objectContaining({ document_id: 'doc-opp' }),
    );
    expect(mocks.upsertLeadFromDust).toHaveBeenCalledWith(
      ORG_A,
      expect.objectContaining({ document_id: 'doc-lead' }),
    );
    expect(mocks.upsertCompanyFromDust).toHaveBeenCalledWith(
      ORG_A,
      expect.objectContaining({ document_id: 'doc-company' }),
    );
    expect(mocks.upsertNoteFromDust).toHaveBeenCalledWith(
      ORG_A,
      expect.objectContaining({ document_id: 'doc-note' }),
    );

    expect(mocks.syncEventCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        orgId: ORG_A,
        eventType: 'poll.completed',
        status: 'processed',
        payload: expect.objectContaining({
          documentCount: 4,
          opportunity: 1,
          lead: 1,
          company: 1,
          note: 1,
          skipped: 0,
          errors: 0,
        }),
      }),
    });
  });

  it('routes by metadata precedence — opportunity_code wins over company_name when a doc has both', async () => {
    const dustClient = {
      listDocuments: vi.fn().mockResolvedValue([{ document_id: 'doc-1' }]),
      getDocument: vi.fn().mockResolvedValue({
        document_id: 'doc-1',
        metadata: { opportunity_code: 'OPP-1', company_name: 'Acme' },
      }),
    };
    mocks.getOrgDust.mockResolvedValue({ client: dustClient, creds: { dataSourceId: 'ds-1' } });
    mocks.upsertOpportunityFromDust.mockResolvedValue({ id: 'opp-1', created: true, skipped: false });

    await pollOrgDust(ORG_A, log);

    expect(mocks.upsertOpportunityFromDust).toHaveBeenCalled();
    expect(mocks.upsertCompanyFromDust).not.toHaveBeenCalled();
  });

  it('a malformed doc is caught and tallied as an error — it does not fail the whole org poll (skip, not fail-loud)', async () => {
    const dustClient = {
      listDocuments: vi.fn().mockResolvedValue([{ document_id: 'doc-bad' }, { document_id: 'doc-good' }]),
      getDocument: vi.fn().mockImplementation(async (_ds: string, id: string) => ({
        document_id: id,
        metadata: id === 'doc-bad' ? { opportunity_code: '' } : { lead_email: 'ok@x.com' },
      })),
    };
    mocks.getOrgDust.mockResolvedValue({ client: dustClient, creds: { dataSourceId: 'ds-1' } });
    mocks.upsertOpportunityFromDust.mockRejectedValue(
      new Error('Missing opportunity_code in Dust document metadata'),
    );
    mocks.upsertLeadFromDust.mockResolvedValue({ id: 'lead-1', created: true, skipped: false });

    await expect(pollOrgDust(ORG_A, log)).resolves.toBeUndefined();

    // the doc after the bad one is still processed — one failure doesn't abort the loop
    expect(mocks.upsertLeadFromDust).toHaveBeenCalled();
    expect(logImpl.warn).toHaveBeenCalledWith(
      expect.objectContaining({ docId: 'doc-bad' }),
      'failed to process dust document',
    );
    expect(mocks.syncEventCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        payload: expect.objectContaining({ errors: 1, lead: 1 }),
      }),
    });
  });

  it('propagates a hard Dust API failure (listDocuments) without writing any sync_event telemetry', async () => {
    // WHY this matters: the "not configured" stub path above DOES write a
    // sync_event, but a real Dust outage writes nothing — the only signal is
    // the rejected promise (which becomes a BullMQ job failure + retry) and
    // whatever the caller's circuit breaker does with it. There is no
    // persisted row an admin can query to see "this org's last poll failed".
    mocks.getOrgDust.mockResolvedValue({
      client: {
        listDocuments: vi.fn().mockRejectedValue(new Error('Dust GET /documents failed with 500')),
        getDocument: vi.fn(),
      },
      creds: { dataSourceId: 'ds-1' },
    });

    await expect(pollOrgDust(ORG_A, log)).rejects.toThrow(/500/);

    expect(mocks.syncEventCreate).not.toHaveBeenCalled();
  });

  it('never resolves credentials or writes telemetry for any org other than the one passed in', async () => {
    mocks.getOrgDust.mockResolvedValue({ client: null, creds: null });

    await pollOrgDust(ORG_A, log);

    expect(mocks.getOrgDust).toHaveBeenCalledTimes(1);
    expect(mocks.getOrgDust).toHaveBeenCalledWith(ORG_A, expect.anything());
    expect(mocks.syncEventCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ orgId: ORG_A }) }),
    );
    expect(mocks.syncEventCreate).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ orgId: ORG_B }) }),
    );
  });
});

describe('fanoutOrgPolls', () => {
  it('cursor-paginates every org in batches of 200 and enqueues exactly one per-org job each', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-01T00:00:00.000Z'));

    // ORG_BATCH_SIZE (200) is private to dust-poll.ts — a full first page
    // forces a second findMany call, proving the cursor loop continues.
    const firstBatch = Array.from({ length: 200 }, (_, i) => ({
      id: `org-${i.toString().padStart(3, '0')}`,
    }));
    const secondBatch = [{ id: 'org-200' }];
    mocks.orgFindMany.mockResolvedValueOnce(firstBatch).mockResolvedValueOnce(secondBatch);

    const queue = { add: vi.fn() } as unknown as Queue;
    await fanoutOrgPolls(queue, log);

    expect(mocks.orgFindMany).toHaveBeenCalledTimes(2);
    // first page has no cursor
    const firstCallArgs = mocks.orgFindMany.mock.calls[0]![0];
    expect(firstCallArgs).toMatchObject({ take: 200, orderBy: { id: 'asc' } });
    expect(firstCallArgs).not.toHaveProperty('cursor');
    // second page continues from the last id of the first page
    expect(mocks.orgFindMany.mock.calls[1]![0]).toMatchObject({
      skip: 1,
      cursor: { id: 'org-199' },
    });

    expect(queue.add).toHaveBeenCalledTimes(201);
    // jobId dedup key is per (org, time-window) — a single fixed window across
    // the whole fanout run, mirroring email-sync's fanout, so overlapping
    // ticks can't double-dispatch the same org.
    const windowBucket = Math.floor(Date.now() / (5 * 60 * 1000));
    expect(queue.add).toHaveBeenCalledWith(
      'dust.poll',
      { source: 'scheduled', orgId: 'org-000' },
      { jobId: `dust-poll:org-000:${windowBucket}` },
    );
    expect(queue.add).toHaveBeenCalledWith(
      'dust.poll',
      { source: 'scheduled', orgId: 'org-200' },
      { jobId: `dust-poll:org-200:${windowBucket}` },
    );
  });

  it('produces the same per-org jobId across two fanout runs in the same window (BullMQ dedupes, no double dispatch)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-01T00:00:00.000Z'));
    mocks.orgFindMany.mockResolvedValue([{ id: 'org-a' }]);
    const queue = { add: vi.fn() } as unknown as Queue;

    await fanoutOrgPolls(queue, log);
    await fanoutOrgPolls(queue, log);

    const jobIds = vi
      .mocked(queue.add)
      .mock.calls.map((call) => (call[2] as { jobId: string }).jobId);
    expect(jobIds[0]).toBe(jobIds[1]);
  });

  it('stops paginating once an org batch comes back empty and enqueues nothing', async () => {
    mocks.orgFindMany.mockResolvedValueOnce([]);
    const queue = { add: vi.fn() } as unknown as Queue;

    await fanoutOrgPolls(queue, log);

    expect(mocks.orgFindMany).toHaveBeenCalledTimes(1);
    expect(queue.add).not.toHaveBeenCalled();
  });
});

describe('per-org circuit breaker', () => {
  afterEach(() => {
    resetDustCircuitBreakerForTest();
  });

  it("org A tripping the breaker does not block org B's poll", async () => {
    // WHY: the breaker used to be two module-level scalars shared by every
    // job, so one tenant with revoked Dust credentials opened the circuit
    // fleet-wide — every other org's ingestion froze for the 10-min cooldown,
    // over and over. Tenant isolation demands each org trips alone.
    mocks.getOrgDust.mockRejectedValue(new Error('Dust auth failed with 401'));
    for (let i = 0; i < 3; i++) {
      await expect(pollOrgDustWithBreaker(ORG_A, log)).rejects.toThrow(/401/);
    }

    // ORG_A's own circuit is open: its next poll short-circuits before even
    // resolving credentials...
    mocks.getOrgDust.mockClear();
    await expect(pollOrgDustWithBreaker(ORG_A, log)).resolves.toBeUndefined();
    expect(mocks.getOrgDust).not.toHaveBeenCalled();
    expect(logImpl.warn).toHaveBeenCalledWith({ orgId: ORG_A }, 'circuit open, skipping dust poll');

    // ...while ORG_B's poll still runs to completion.
    mocks.getOrgDust.mockResolvedValue({ client: null, creds: null });
    await pollOrgDustWithBreaker(ORG_B, log);
    expect(mocks.getOrgDust).toHaveBeenCalledWith(ORG_B, expect.anything());
    expect(mocks.syncEventCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ orgId: ORG_B }) }),
    );
  });

  it("one org's success does not reset another org's failure streak", async () => {
    // WHY: the old global counter zeroed on ANY org's success, so a healthy
    // tenant completing a poll masked a broken tenant's streak and the
    // breaker could never actually trip for the org that was failing.
    mocks.getOrgDust.mockRejectedValue(new Error('boom'));
    await expect(pollOrgDustWithBreaker(ORG_A, log)).rejects.toThrow();
    await expect(pollOrgDustWithBreaker(ORG_A, log)).rejects.toThrow();

    mocks.getOrgDust.mockResolvedValue({ client: null, creds: null });
    await pollOrgDustWithBreaker(ORG_B, log);

    mocks.getOrgDust.mockRejectedValue(new Error('boom'));
    await expect(pollOrgDustWithBreaker(ORG_A, log)).rejects.toThrow();

    expect(isDustCircuitOpen(ORG_A)).toBe(true);
    expect(isDustCircuitOpen(ORG_B)).toBe(false);
  });

  it('interleaved failures from different orgs never pool into a shared trip count', () => {
    // WHY: 3 back-to-back failures from ANY mix of orgs used to open the one
    // shared circuit — 2 from A + 1 from B must not open anything.
    recordDustPollFailure(ORG_A);
    recordDustPollFailure(ORG_B);
    const third = recordDustPollFailure(ORG_A);

    expect(third).toEqual({ consecutiveFailures: 2, opened: false });
    expect(isDustCircuitOpen(ORG_A)).toBe(false);
    expect(isDustCircuitOpen(ORG_B)).toBe(false);
  });

  it("an open circuit closes after the cooldown so the org's polls resume on their own", () => {
    const t0 = Date.parse('2026-07-01T00:00:00.000Z');
    for (let i = 0; i < 3; i++) recordDustPollFailure(ORG_A, t0);

    expect(isDustCircuitOpen(ORG_A, t0)).toBe(true);
    // CIRCUIT_COOLDOWN_MS (10 min) is private to dust-poll.ts
    expect(isDustCircuitOpen(ORG_A, t0 + 10 * 60 * 1000)).toBe(false);
  });

  it('a stale failure streak expires instead of counting toward a much later trip (TTL bound)', () => {
    // WHY: without a TTL the map keeps an entry for every org that ever
    // failed once, and a single hiccup last week would count toward a trip
    // today.
    const t0 = Date.parse('2026-07-01T00:00:00.000Z');
    recordDustPollFailure(ORG_A, t0);
    recordDustPollFailure(ORG_A, t0);

    // 30 min later — past BREAKER_TTL_MS (2× cooldown, private to
    // dust-poll.ts) — the stale streak is swept and the count restarts at 1.
    const fresh = recordDustPollFailure(ORG_A, t0 + 30 * 60 * 1000);
    expect(fresh).toEqual({ consecutiveFailures: 1, opened: false });
  });

  it('the breaker map is size-capped: flooding evicts the oldest org instead of growing unbounded', () => {
    // WHY: at 100k+ orgs an unbounded Map keyed by orgId is a slow memory
    // leak in a long-lived worker. Eviction fails safe — a forgotten open
    // circuit costs one extra poll attempt, never a blocked tenant.
    const t0 = Date.parse('2026-07-01T00:00:00.000Z');
    for (let i = 0; i < 3; i++) recordDustPollFailure(ORG_A, t0);
    expect(isDustCircuitOpen(ORG_A, t0)).toBe(true);

    // BREAKER_MAX_ORGS (10_000) is private to dust-poll.ts. Same-timestamp
    // failures dodge the TTL sweep, so only the size cap can bound the map.
    for (let i = 0; i < 10_000; i++) recordDustPollFailure(`org-${i}`, t0);

    expect(isDustCircuitOpen(ORG_A, t0)).toBe(false);
  });
});
