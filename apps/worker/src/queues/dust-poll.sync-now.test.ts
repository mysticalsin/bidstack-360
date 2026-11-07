// "Sync now" reads the BullMQ return value of a per-org Dust poll to show
// new, updated, skipped and failed counts. These tests pin that return shape.
import type pino from 'pino';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  syncEventCreate: vi.fn(),
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
    org: { findMany: vi.fn(), findUnique: mocks.orgFindUnique },
  },
}));
vi.mock('../lib/dust-credentials.js', () => ({ getOrgDust: mocks.getOrgDust }));
vi.mock('./dust-sync-helpers.js', () => ({
  upsertOpportunityFromDust: mocks.upsertOpportunityFromDust,
  upsertCompanyFromDust: mocks.upsertCompanyFromDust,
  upsertNoteFromDust: mocks.upsertNoteFromDust,
  upsertLeadFromDust: mocks.upsertLeadFromDust,
}));

import {
  pollOrgDust,
  pollOrgDustWithBreaker,
  recordDustPollFailure,
  resetDustCircuitBreakerForTest,
} from './dust-poll.js';

const ORG = '00000000-0000-4000-8000-000000000001';
const log = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  child: () => log,
} as unknown as pino.Logger;

function dustWith(docs: Array<{ id: string; metadata: Record<string, unknown> }>) {
  return {
    listDocuments: vi.fn(async () => docs.map((d) => ({ document_id: d.id }))),
    getDocument: vi.fn(async (_ds: string, id: string) => {
      const doc = docs.find((d) => d.id === id)!;
      if (doc.metadata.boom) throw new Error('bad doc');
      return { document_id: id, metadata: doc.metadata };
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetDustCircuitBreakerForTest();
  mocks.orgFindUnique.mockResolvedValue({ id: ORG });
  mocks.syncEventCreate.mockResolvedValue({});
});

describe('pollOrgDust return value', () => {
  it('splits created from updated, and counts skipped and failed documents', async () => {
    mocks.getOrgDust.mockResolvedValue({
      client: dustWith([
        { id: 'o1', metadata: { opportunity_code: 'OP-1' } },
        { id: 'o2', metadata: { opportunity_code: 'OP-2' } },
        { id: 'c1', metadata: { company_name: 'DNB' } },
        { id: 'l1', metadata: { lead_email: 'a@b.c' } },
        { id: 'x1', metadata: { boom: true } },
      ]),
      creds: { dataSourceId: 'ds' },
    });
    mocks.upsertOpportunityFromDust
      .mockResolvedValueOnce({ id: '1', created: true, skipped: false })
      .mockResolvedValueOnce({ id: '2', created: false, skipped: false });
    mocks.upsertCompanyFromDust.mockResolvedValue({ id: '3', created: true });
    mocks.upsertLeadFromDust.mockResolvedValue({ id: '4', created: false, skipped: true });

    const out = await pollOrgDust(ORG, log);
    expect(out).toEqual({ created: 2, updated: 1, skipped: 1, errors: 1 });
  });

  it('reports not_configured when the org has no Dust workspace', async () => {
    mocks.getOrgDust.mockResolvedValue({ client: null, creds: null });
    const out = await pollOrgDust(ORG, log);
    expect(out).toMatchObject({ created: 0, updated: 0, skipped: 0, errors: 0, reason: 'not_configured' });
  });

  it('reports circuit_open when the breaker skips the poll', async () => {
    for (let i = 0; i < 10; i++) recordDustPollFailure(ORG);
    const out = await pollOrgDustWithBreaker(ORG, log);
    expect(out).toMatchObject({ reason: 'circuit_open' });
  });
});
