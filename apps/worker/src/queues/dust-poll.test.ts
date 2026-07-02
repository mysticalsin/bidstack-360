// Unit tests for dust-poll's per-org sync loop (pollOrgDust) and the org
// fanout cursor pagination (fanoutOrgPolls). getOrgDust, the dust-sync-helpers
// upserts, and prisma are all mocked, so these exercise dust-poll.ts's OWN
// routing/telemetry/pagination logic in isolation — the Dust → CRM mapping
// logic itself is covered by dust-sync-helpers.test.ts.
//
// pollOrgDust/fanoutOrgPolls were made `export`ed (previously module-private)
// solely so this suite can call them directly, mirroring how
// calendar-sync-microsoft.ts already exports its per-item handlers for unit
// testing instead of only being reachable through a live BullMQ Worker.
import type { Queue } from 'bullmq';
import type pino from 'pino';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  syncEventCreate: vi.fn(),
  orgFindMany: vi.fn(),
  getOrgDust: vi.fn(),
  upsertOpportunityFromDust: vi.fn(),
  upsertCompanyFromDust: vi.fn(),
  upsertNoteFromDust: vi.fn(),
  upsertLeadFromDust: vi.fn(),
}));

vi.mock('@bidstack/db', () => ({
  prisma: {
    syncEvent: { create: mocks.syncEventCreate },
    org: { findMany: mocks.orgFindMany },
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

import { fanoutOrgPolls, pollOrgDust } from './dust-poll.js';

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

describe('pollOrgDust', () => {
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
