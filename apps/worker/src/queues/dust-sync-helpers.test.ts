// Unit tests for the Dust → CRM entity mapping helpers used by both the
// scheduled poll worker (dust-poll.ts) and the webhook processor. Every test
// mocks '@bidstack/db' — no real Postgres — so these encode WHY each mapping
// is correct: org scoping, re-delivery idempotency, and fail-loud vs.
// silent-skip behavior on partial payloads, per the task's required coverage.
import { afterEach, describe, expect, it, vi } from 'vitest';

// vi.hoisted (not vi.mocked(prisma.x.y)) so mockResolvedValue doesn't have to
// satisfy the full generated Prisma model type for every fixture — same
// pattern as the sibling dust-credentials.test.ts.
const mocks = vi.hoisted(() => ({
  oppFindUnique: vi.fn(),
  oppUpsert: vi.fn(),
  companyFindUnique: vi.fn(),
  companyUpsert: vi.fn(),
  noteFindFirst: vi.fn(),
  noteUpsert: vi.fn(),
  leadFindFirst: vi.fn(),
  leadUpsert: vi.fn(),
  auditLogCreate: vi.fn(),
  userFindFirst: vi.fn(),
}));

vi.mock('@bidstack/db', () => ({
  prisma: {
    opportunity: { findUnique: mocks.oppFindUnique, upsert: mocks.oppUpsert },
    companyEnrichment: { findUnique: mocks.companyFindUnique, upsert: mocks.companyUpsert },
    note: { findFirst: mocks.noteFindFirst, upsert: mocks.noteUpsert },
    lead: { findFirst: mocks.leadFindFirst, upsert: mocks.leadUpsert },
    auditLog: { create: mocks.auditLogCreate },
    user: { findFirst: mocks.userFindFirst },
  },
}));

import {
  normalizeName,
  upsertCompanyFromDust,
  upsertLeadFromDust,
  upsertNoteFromDust,
  upsertOpportunityFromDust,
} from './dust-sync-helpers.js';

const ORG_A = '00000000-0000-4000-8000-000000000001';
const ORG_B = '00000000-0000-4000-8000-000000000002';

afterEach(() => {
  vi.clearAllMocks();
});

describe('normalizeName', () => {
  it('matches company-enrich-apollo.ts\'s own copy of this logic (currently duplicated, not shared)', () => {
    // Both files independently implement the same slugify rule. If one drifts
    // from the other, a company synced via Dust and one synced via Apollo
    // could land on two different normalizedName rows for the same company.
    expect(normalizeName('Acme, Inc.')).toBe('acme-inc');
    expect(normalizeName('  Rush University System for Health  ')).toBe(
      'rush-university-system-for-health',
    );
  });
});

describe('upsertOpportunityFromDust', () => {
  const doc = {
    document_id: 'doc-opp-1',
    text: 'RFP context text',
    metadata: {
      opportunity_code: 'OPP-100',
      opportunity_name: 'Acme Deal',
      customer_name: 'Acme Corp',
    },
  };

  it('creates a new opportunity scoped to the org on first sync', async () => {
    mocks.oppFindUnique.mockResolvedValue(null);
    mocks.oppUpsert.mockResolvedValue({ id: 'opp-1' });

    const result = await upsertOpportunityFromDust(ORG_A, doc);

    expect(result).toEqual({ id: 'opp-1', created: true, skipped: false });
    expect(mocks.oppFindUnique).toHaveBeenCalledWith({
      where: { orgId_code: { orgId: ORG_A, code: 'OPP-100' } },
      select: { id: true, intel: true, dustLastPushedAt: true },
    });
    const upsertArgs = mocks.oppUpsert.mock.calls[0]![0];
    expect(upsertArgs.where).toEqual({ orgId_code: { orgId: ORG_A, code: 'OPP-100' } });
    expect(upsertArgs.create).toMatchObject({
      orgId: ORG_A,
      code: 'OPP-100',
      customer: 'Acme Corp',
      name: 'Acme Deal',
      stage: 's1_ongoing',
      dustDocId: 'doc-opp-1',
    });
    expect(mocks.auditLogCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        orgId: ORG_A,
        action: 'opportunity.created.dust',
        targetType: 'opportunity',
        targetId: 'opp-1',
      }),
    });
  });

  it('re-delivery outside the conflict window updates the same row instead of duplicating it', async () => {
    const existing = {
      id: 'opp-1',
      intel: { priorField: 'kept' },
      dustLastPushedAt: new Date(Date.now() - 10 * 60_000), // 10 min ago — outside the 5-min window
    };
    mocks.oppFindUnique.mockResolvedValue(existing);
    mocks.oppUpsert.mockResolvedValue({ id: 'opp-1' });

    const result = await upsertOpportunityFromDust(ORG_A, doc);

    expect(result).toEqual({ id: 'opp-1', created: false, skipped: false });
    const upsertArgs = mocks.oppUpsert.mock.calls[0]![0];
    // Intel is merged (prior fields kept), not clobbered by the Dust sync.
    expect(upsertArgs.update.intel).toMatchObject({ priorField: 'kept', dustDocId: 'doc-opp-1' });
    expect(mocks.auditLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'opportunity.updated.dust' }) }),
    );
  });

  it('skips the write when the row was pushed to Dust in the last 5 minutes (conflict window back-pressure)', async () => {
    // WHY this IS the idempotency guard for outbound sync: without it, an
    // inbound poll racing an outbound push could immediately overwrite what
    // this app just wrote to Dust.
    mocks.oppFindUnique.mockResolvedValue({
      id: 'opp-1',
      intel: {},
      dustLastPushedAt: new Date(),
    });

    const result = await upsertOpportunityFromDust(ORG_A, doc);

    expect(result).toEqual({ id: 'opp-1', created: false, skipped: true });
    expect(mocks.oppUpsert).not.toHaveBeenCalled();
    expect(mocks.auditLogCreate).not.toHaveBeenCalled();
  });

  it('fails loud on a blank opportunity_code (malformed payload — current design does not silently skip here)', async () => {
    await expect(
      upsertOpportunityFromDust(ORG_A, { document_id: 'd1', metadata: { opportunity_code: '' } }),
    ).rejects.toThrow(/Missing opportunity_code/);
    expect(mocks.oppFindUnique).not.toHaveBeenCalled();
  });

  it('never resolves a code against another org\'s row — orgId is part of the lookup key', async () => {
    mocks.oppFindUnique.mockResolvedValue(null);
    mocks.oppUpsert.mockResolvedValue({ id: 'opp-a' });
    await upsertOpportunityFromDust(ORG_A, doc);
    expect(mocks.oppFindUnique.mock.calls[0]![0].where).toEqual({
      orgId_code: { orgId: ORG_A, code: 'OPP-100' },
    });

    mocks.oppFindUnique.mockResolvedValue(null);
    mocks.oppUpsert.mockResolvedValue({ id: 'opp-b' });
    await upsertOpportunityFromDust(ORG_B, doc);
    expect(mocks.oppFindUnique.mock.calls[1]![0].where).toEqual({
      orgId_code: { orgId: ORG_B, code: 'OPP-100' },
    });
  });
});

describe('upsertCompanyFromDust', () => {
  it('fails loud when company_name is missing (malformed payload)', async () => {
    await expect(upsertCompanyFromDust(ORG_A, { document_id: 'd1', metadata: {} })).rejects.toThrow(
      /Missing company_name/,
    );
  });

  it('creates a new enrichment row keyed by org + normalized name on first sync', async () => {
    mocks.companyFindUnique.mockResolvedValue(null);
    mocks.companyUpsert.mockResolvedValue({ id: 'ce-1' });

    const result = await upsertCompanyFromDust(ORG_A, {
      document_id: 'd1',
      metadata: { company_name: 'Acme, Inc.' },
    });

    expect(result).toEqual({ id: 'ce-1', created: true });
    expect(mocks.companyFindUnique).toHaveBeenCalledWith({
      where: { orgId_normalizedName: { orgId: ORG_A, normalizedName: 'acme-inc' } },
      select: { id: true },
    });
  });

  it('re-syncing the same company updates the existing row instead of duplicating it', async () => {
    mocks.companyFindUnique.mockResolvedValue({ id: 'ce-1' });
    mocks.companyUpsert.mockResolvedValue({ id: 'ce-1' });

    const result = await upsertCompanyFromDust(ORG_A, {
      document_id: 'd1',
      metadata: { company_name: 'Acme, Inc.' },
    });

    expect(result).toEqual({ id: 'ce-1', created: false });
  });

  it('the same company name in two different orgs never collides (org is part of the unique key)', async () => {
    mocks.companyFindUnique.mockResolvedValue(null);
    mocks.companyUpsert.mockResolvedValue({ id: 'ce-a' });
    await upsertCompanyFromDust(ORG_A, { document_id: 'd1', metadata: { company_name: 'Acme' } });
    expect(mocks.companyFindUnique.mock.calls[0]![0].where).toEqual({
      orgId_normalizedName: { orgId: ORG_A, normalizedName: 'acme' },
    });

    mocks.companyFindUnique.mockResolvedValue(null);
    mocks.companyUpsert.mockResolvedValue({ id: 'ce-b' });
    await upsertCompanyFromDust(ORG_B, { document_id: 'd1', metadata: { company_name: 'Acme' } });
    expect(mocks.companyFindUnique.mock.calls[1]![0].where).toEqual({
      orgId_normalizedName: { orgId: ORG_B, normalizedName: 'acme' },
    });
  });
});

describe('upsertNoteFromDust', () => {
  it('silently skips (returns null, no error) when the org has no user yet to attribute authorship to', async () => {
    // WHY skip not fail-loud: a note has no owner without a user; failing the
    // whole doc loop for a brand-new org with zero users would block every
    // other doc type behind an unrelated precondition.
    mocks.userFindFirst.mockResolvedValue(null);

    const result = await upsertNoteFromDust(ORG_A, { document_id: 'd1', metadata: {} });

    expect(result).toBeNull();
    expect(mocks.noteFindFirst).not.toHaveBeenCalled();
  });

  it('creates a new note scoped to the org on first sync', async () => {
    mocks.userFindFirst.mockResolvedValue({ id: 'user-1' });
    mocks.noteFindFirst.mockResolvedValue(null);
    mocks.noteUpsert.mockResolvedValue({ id: 'note-1' });

    const result = await upsertNoteFromDust(ORG_A, {
      document_id: 'd1',
      text: 'body',
      metadata: { title: 'Kickoff notes' },
    });

    expect(result).toEqual({ id: 'note-1', created: true });
    expect(mocks.noteFindFirst).toHaveBeenCalledWith({
      where: { orgId: ORG_A, dustDocId: 'd1' },
      select: { id: true },
    });
    expect(mocks.noteUpsert.mock.calls[0]![0].create).toMatchObject({
      orgId: ORG_A,
      authorUserId: 'user-1',
      dustDocId: 'd1',
    });
  });

  it('re-delivery of the same document updates the existing note instead of creating a duplicate', async () => {
    mocks.userFindFirst.mockResolvedValue({ id: 'user-1' });
    mocks.noteFindFirst.mockResolvedValue({ id: 'note-1' });
    mocks.noteUpsert.mockResolvedValue({ id: 'note-1' });

    const result = await upsertNoteFromDust(ORG_A, {
      document_id: 'd1',
      text: 'updated body',
      metadata: {},
    });

    expect(result).toEqual({ id: 'note-1', created: false });
    expect(mocks.noteUpsert.mock.calls[0]![0].where).toEqual({ id: 'note-1' });
  });

  it('scopes the duplicate-check by org AND doc id — the same doc id in another org never collides', async () => {
    mocks.userFindFirst.mockResolvedValue({ id: 'user-1' });
    mocks.noteFindFirst.mockResolvedValue(null);
    mocks.noteUpsert.mockResolvedValue({ id: 'note-b' });

    await upsertNoteFromDust(ORG_B, { document_id: 'shared-doc-id', metadata: {} });

    expect(mocks.noteFindFirst).toHaveBeenCalledWith({
      where: { orgId: ORG_B, dustDocId: 'shared-doc-id' },
      select: { id: true },
    });
  });
});

describe('upsertLeadFromDust', () => {
  it('fails loud when both lead_email and lead_last_name are missing', async () => {
    await expect(upsertLeadFromDust(ORG_A, { document_id: 'd1', metadata: {} })).rejects.toThrow(
      /Missing lead_email or lead_last_name/,
    );
  });

  it('creates a new lead scoped to the org when email is present', async () => {
    mocks.leadFindFirst.mockResolvedValue(null);
    mocks.leadUpsert.mockResolvedValue({ id: 'lead-1' });

    const result = await upsertLeadFromDust(ORG_A, {
      document_id: 'd1',
      metadata: {
        lead_email: 'jane@acme.com',
        lead_first_name: 'Jane',
        lead_last_name: 'Doe',
        company_name: 'Acme',
      },
    });

    expect(result).toEqual({ id: 'lead-1', created: true, skipped: false });
    expect(mocks.leadFindFirst).toHaveBeenCalledWith({
      where: { orgId: ORG_A, email: 'jane@acme.com' },
      select: { id: true, dustLastPushedAt: true },
    });
  });

  it('re-delivery with the same email updates the same lead instead of duplicating it', async () => {
    mocks.leadFindFirst.mockResolvedValue({ id: 'lead-1', dustLastPushedAt: null });
    mocks.leadUpsert.mockResolvedValue({ id: 'lead-1' });

    const result = await upsertLeadFromDust(ORG_A, {
      document_id: 'd1',
      metadata: { lead_email: 'jane@acme.com', lead_last_name: 'Doe' },
    });

    expect(result.created).toBe(false);
    expect(mocks.leadUpsert.mock.calls[0]![0].where).toEqual({ id: 'lead-1' });
  });

  it('skips the write when the row was pushed to Dust in the last 5 minutes (conflict window)', async () => {
    mocks.leadFindFirst.mockResolvedValue({ id: 'lead-1', dustLastPushedAt: new Date() });

    const result = await upsertLeadFromDust(ORG_A, {
      document_id: 'd1',
      metadata: { lead_email: 'jane@acme.com', lead_last_name: 'Doe' },
    });

    expect(result).toEqual({ id: 'lead-1', created: false, skipped: true });
    expect(mocks.leadUpsert).not.toHaveBeenCalled();
  });

  // FIXED: a Dust doc with no lead_email (only a last name, which the guard
  // above allows) used to build `findFirst({ where: { orgId, email: undefined } })`.
  // Prisma drops undefined-valued keys from `where`, so that was actually
  // `findFirst({ where: { orgId } })` — it matched ANY pre-existing lead in
  // the org, and the upsert then overwrote that unrelated lead's
  // name/company/notes. The lookup now keys on this document's own dustDocId
  // instead, so it can only ever touch a lead this exact document created.
  it('when lead_email is missing, never runs an email-keyed lookup — matches by this document\'s own dustDocId instead', async () => {
    mocks.leadFindFirst.mockResolvedValue(null);
    mocks.leadUpsert.mockResolvedValue({ id: 'lead-new' });

    const result = await upsertLeadFromDust(ORG_A, {
      document_id: 'doc-no-email',
      metadata: { lead_last_name: 'Smith', company_name: 'Globex' },
    });

    expect(mocks.leadFindFirst).toHaveBeenCalledWith({
      where: { orgId: ORG_A, dustDocId: 'doc-no-email' },
      select: { id: true, dustLastPushedAt: true },
    });
    expect(result).toEqual({ id: 'lead-new', created: true, skipped: false });
  });

  it('re-delivery of the same no-email document updates the lead IT created, never an unrelated same-org lead', async () => {
    // A different pre-existing lead in the same org (e.g. 'some-other-lead')
    // is simply never looked up here — the where clause is scoped to
    // dustDocId, so it cannot be matched by this call regardless of what
    // other leads exist in the org.
    mocks.leadFindFirst.mockResolvedValue({ id: 'lead-from-doc', dustLastPushedAt: null });
    mocks.leadUpsert.mockResolvedValue({ id: 'lead-from-doc' });

    const result = await upsertLeadFromDust(ORG_A, {
      document_id: 'doc-no-email',
      metadata: { lead_last_name: 'Smith', company_name: 'Globex' },
    });

    expect(result.created).toBe(false);
    expect(mocks.leadUpsert.mock.calls[0]![0].where).toEqual({ id: 'lead-from-doc' });
  });

  it('scopes the lookup by org AND email when email is present — no cross-org match', async () => {
    mocks.leadFindFirst.mockResolvedValue(null);
    mocks.leadUpsert.mockResolvedValue({ id: 'lead-b' });

    await upsertLeadFromDust(ORG_B, {
      document_id: 'd1',
      metadata: { lead_email: 'jane@acme.com', lead_last_name: 'Doe' },
    });

    expect(mocks.leadFindFirst).toHaveBeenCalledWith({
      where: { orgId: ORG_B, email: 'jane@acme.com' },
      select: { id: true, dustLastPushedAt: true },
    });
  });
});
