import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_CONSULTING_FIRMS } from '@bidstack/shared';

import type * as PartnerDb from '../consulting-partners.js';
import type { PartnerEvidenceRow } from '../consulting-partners.js';

const NOW = new Date('2026-11-06T12:00:00Z');
const COMPANY = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';

function row(over: Partial<PartnerEvidenceRow>): PartnerEvidenceRow {
  return {
    id: 'r', orgId: 'org-1', companyId: COMPANY, firmKey: 'kpmg', firmName: 'KPMG', origin: 'public', source: 'google_news', method: 'keyword_match',
    inferred: false, key: 'k', url: 'https://news.example.com/a', recordType: null, recordId: null, opportunityId: null, title: 'MAPFRE selects KPMG',
    excerpt: 'MAPFRE selects KPMG for advisory.', occurredAt: NOW, fetchedAt: NOW, relationship: 'advisory', domains: ['digital'], context: null,
    sentiment: null, remarks: [], outcome: null, sample: false, createdAt: NOW, updatedAt: NOW, ...over,
  } as PartnerEvidenceRow;
}

const rows: PartnerEvidenceRow[] = [
  row({ id: 'pub1', key: 'pub:1' }),
  row({
    id: 'int1', key: 'int:note:n1', origin: 'internal', source: 'note', method: 'keyword_match', url: null, recordType: 'note', recordId: '33333333-3333-4333-8333-333333333333',
    excerpt: 'Client said our quality is better than KPMG <script>x</script>.', relationship: null, context: 'client_feedback', sentiment: 'positive',
    remarks: [{ dimension: 'quality', favours: 'us', phrase: 'better than KPMG' }],
  }),
];

const findFirst = vi.fn();
const owned = vi.fn();
vi.mock('../index.js', () => ({ prisma: { company: { findFirst: (...a: unknown[]) => findFirst(...a) } } }));
vi.mock('../consulting-partners.js', async (orig) => ({
  ...(await orig<typeof PartnerDb>()),
  loadPartnerEvidenceRows: async () => rows,
  loadOrgFirmCatalog: async () => DEFAULT_CONSULTING_FIRMS,
  countPartnerEngagements: async () => ({ won: 1, open: 1 }),
  loadPartnerRun: async () => ({ status: 'ok', lastFetchedAt: NOW.toISOString(), result: { new: 2, updated: 0, skipped: 0, failed: 0 }, detail: null }),
  ownedPartnerRowIds: (...a: unknown[]) => owned(...a),
}));

import { agentTools } from './index.js';

const tool = agentTools.consulting_partners;
type Out = { partners: Array<{ firmKey: string; internalCount: number; scorecard: Array<{ dimension: string; status: string; evidenceIds: string[] }>; angles: Array<{ evidenceIds: string[] }> }>; evidence: Array<{ id: string; excerpt: string }>; citations: Array<{ href: string }> };

describe('consulting_partners shared agent tool', () => {
  beforeEach(() => {
    findFirst.mockReset().mockResolvedValue({ id: COMPANY, name: 'MAPFRE' });
    owned.mockReset().mockResolvedValue(new Set(['int1']));
  });

  it('is a read tool gated by account-intel:read', () => {
    expect(tool.kind).toBe('read');
    expect(tool.permission).toBe('account-intel:read');
  });

  it('gives an MCP key public evidence only, so quality has no evidence', async () => {
    const out = (await tool.handler({ companyId: COMPANY, limit: 6 }, { orgId: 'org-1' })) as Out;
    expect(owned).not.toHaveBeenCalled();
    expect(out.partners[0]!.internalCount).toBe(0);
    expect(out.partners[0]!.scorecard.find((d) => d.dimension === 'quality')!.status).toBe('no_evidence');
    expect(out.citations[0]!.href).toBe(`/accounts/${COMPANY}`);
  });

  it('adds internal records the Jarvis user owns, cited and fenced', async () => {
    const out = (await tool.handler({ companyId: COMPANY, limit: 6 }, { orgId: 'org-1', userId: USER, surface: 'jarvis' })) as Out;
    expect(owned).toHaveBeenCalledWith(expect.anything(), 'org-1', USER, [expect.objectContaining({ id: 'int1' })]);
    const quality = out.partners[0]!.scorecard.find((d) => d.dimension === 'quality')!;
    expect(quality.status).toBe('scored');
    const ids = new Set(out.evidence.map((e) => e.id));
    for (const a of out.partners[0]!.angles) for (const id of a.evidenceIds) expect(ids.has(id)).toBe(true);
    expect(out.evidence.find((e) => e.id === 'int1')!.excerpt).not.toContain('<script>');
  });

  it('drops internal records the Jarvis user cannot vouch for', async () => {
    owned.mockResolvedValue(new Set());
    const out = (await tool.handler({ companyId: COMPANY, limit: 6 }, { orgId: 'org-1', userId: USER, surface: 'jarvis' })) as Out;
    expect(out.partners[0]!.internalCount).toBe(0);
  });

  it('resolves the account inside the caller org only', async () => {
    findFirst.mockResolvedValue(null);
    await expect(tool.handler({ companyName: 'Nobody', limit: 6 }, { orgId: 'org-1' })).rejects.toThrow(/not found/i);
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ orgId: 'org-1', deletedAt: null }) }));
  });
});
