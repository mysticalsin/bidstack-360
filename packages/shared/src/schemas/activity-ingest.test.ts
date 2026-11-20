import { describe, expect, it } from 'vitest';

import {
  CompanyActivitySummary,
  INGEST_MAX_BATCH,
  IngestActivitiesRequest,
  IngestActivity,
} from './activity-ingest.js';

const base = {
  externalSource: 'hubspot',
  externalId: 'call-1001',
  type: 'call',
  occurredAt: '2026-11-02T14:30:00Z',
  company: { domain: 'dnb.no' },
};

describe('IngestActivity', () => {
  it('accepts a call mapped to a company by domain', () => {
    expect(IngestActivity.safeParse(base).success).toBe(true);
  });

  it('requires externalSource and externalId, the dedupe key', () => {
    const { externalId: _id, ...noId } = base;
    const { externalSource: _src, ...noSource } = base;
    expect(IngestActivity.safeParse(noId).success).toBe(false);
    expect(IngestActivity.safeParse(noSource).success).toBe(false);
  });

  it('rejects an externalSource that could not be a stable key', () => {
    expect(IngestActivity.safeParse({ ...base, externalSource: 'has spaces' }).success).toBe(false);
  });

  it('requires a company or an opportunity, otherwise the record has no home', () => {
    const { company: _c, ...orphan } = base;
    expect(IngestActivity.safeParse(orphan).success).toBe(false);
    expect(IngestActivity.safeParse({ ...orphan, opportunity: { code: 'OP-2001' } }).success).toBe(
      true,
    );
  });

  it('rejects an empty company reference', () => {
    expect(IngestActivity.safeParse({ ...base, company: {} }).success).toBe(false);
  });

  it('only takes the five inbound activity types', () => {
    for (const type of ['call', 'email', 'meeting', 'note']) {
      expect(IngestActivity.safeParse({ ...base, type }).success).toBe(true);
    }
    expect(IngestActivity.safeParse({ ...base, type: 'field_edit' }).success).toBe(false);
  });

  it('a stage change must say which stage it moved to', () => {
    expect(IngestActivity.safeParse({ ...base, type: 'stage_change' }).success).toBe(false);
    expect(
      IngestActivity.safeParse({ ...base, type: 'stage_change', stage: { to: 'negotiation' } })
        .success,
    ).toBe(true);
  });

  it('rejects malformed participant emails', () => {
    expect(
      IngestActivity.safeParse({ ...base, participants: [{ email: 'not-an-email' }] }).success,
    ).toBe(false);
  });
});

describe('IngestActivitiesRequest', () => {
  it(`caps a batch at ${INGEST_MAX_BATCH}`, () => {
    expect(INGEST_MAX_BATCH).toBe(500);
    const ok = Array.from({ length: 500 }, (_, i) => ({ ...base, externalId: `c-${i}` }));
    expect(IngestActivitiesRequest.safeParse({ activities: ok }).success).toBe(true);
    const tooMany = [...ok, { ...base, externalId: 'c-500' }];
    expect(IngestActivitiesRequest.safeParse({ activities: tooMany }).success).toBe(false);
  });

  it('rejects an empty batch', () => {
    expect(IngestActivitiesRequest.safeParse({ activities: [] }).success).toBe(false);
  });
});

describe('CompanyActivitySummary', () => {
  it('describes 24 hour buckets and weekly rows with overdue', () => {
    const hours = Array.from({ length: 24 }, (_, hour) => ({
      hour,
      call: 0,
      email: 0,
      meeting: 0,
      note: 0,
      stage_change: 0,
    }));
    const parsed = CompanyActivitySummary.safeParse({
      companyId: '00000000-0000-4000-8000-000000000001',
      timezone: 'UTC',
      from: '2026-08-17T00:00:00.000Z',
      to: '2026-11-06T00:00:00.000Z',
      total: 0,
      byHour: hours,
      weekly: [
        {
          weekStart: '2026-11-02',
          call: 1,
          email: 0,
          meeting: 0,
          note: 0,
          stage_change: 0,
          overdue: 2,
        },
      ],
      overdue: { count: 2, oldestDueAt: '2026-10-01T00:00:00.000Z' },
    });
    expect(parsed.success).toBe(true);
  });
});
