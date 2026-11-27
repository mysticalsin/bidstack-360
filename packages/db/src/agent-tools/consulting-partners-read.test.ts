// Jarvis and MCP call consulting_partners. A scan that has not arrived has
// no rows. The tool still returned partners: []. That reads as none found.
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_CONSULTING_FIRMS } from '@bidstack/shared';

import type * as PartnerDb from '../consulting-partners.js';
import type { PartnerEvidenceRow } from '../consulting-partners.js';

const NOW = new Date('2026-11-06T12:00:00Z');
const COMPANY = '11111111-1111-4111-8111-111111111111';
const CHECKING = 'Checking consulting partners. The list has not arrived.';
const FAILED = "Couldn't load consulting partners.";

function row(over: Partial<PartnerEvidenceRow> = {}): PartnerEvidenceRow {
  return {
    id: 'pub1',
    orgId: 'org-1',
    companyId: COMPANY,
    firmKey: 'kpmg',
    firmName: 'KPMG',
    origin: 'public',
    source: 'google_news',
    method: 'keyword_match',
    inferred: false,
    key: 'pub:1',
    url: 'https://news.example.com/a',
    recordType: null,
    recordId: null,
    opportunityId: null,
    title: 'Harbor Synthetic selects KPMG',
    excerpt: 'Harbor Synthetic selects KPMG for advisory.',
    occurredAt: NOW,
    fetchedAt: NOW,
    relationship: 'advisory',
    domains: ['digital'],
    context: null,
    sentiment: null,
    remarks: [],
    outcome: null,
    sample: false,
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  } as PartnerEvidenceRow;
}

type ScanStatus = 'never' | 'queued' | 'running' | 'ok' | 'partial' | 'failed' | 'not_configured';

let rows: PartnerEvidenceRow[] = [];
let scanStatus: ScanStatus = 'never';
const findFirst = vi.fn();
const loadRun = vi.fn();

vi.mock('../index.js', () => ({ prisma: { company: { findFirst: (...a: unknown[]) => findFirst(...a) } } }));
vi.mock('../consulting-partners.js', async (orig) => ({
  ...(await orig<typeof PartnerDb>()),
  loadPartnerEvidenceRows: async () => rows,
  loadOrgFirmCatalog: async () => DEFAULT_CONSULTING_FIRMS,
  countPartnerEngagements: async () => ({ won: 0, open: 0 }),
  loadPartnerRun: (...a: unknown[]) => loadRun(...a),
  ownedPartnerRowIds: async () => new Set<string>(),
}));

import { agentTools } from './index.js';

const tool = agentTools.consulting_partners;

type Out = {
  partners?: Array<{ firmKey: string }>;
  evidence?: unknown[];
  note?: string;
  read?: string;
  account?: string;
};

function answer() {
  return tool.handler({ companyId: COMPANY, limit: 6 }, { orgId: 'org-1' }) as Promise<Out>;
}

describe('consulting_partners unread scan', () => {
  beforeEach(() => {
    rows = [];
    scanStatus = 'never';
    findFirst.mockReset().mockResolvedValue({ id: COMPANY, name: 'Harbor Synthetic' });
    loadRun.mockReset().mockImplementation(async () => ({
      status: scanStatus,
      lastFetchedAt: scanStatus === 'never' ? null : NOW.toISOString(),
      result: { new: 0, updated: 0, skipped: 0, failed: scanStatus === 'failed' ? 1 : 0 },
      detail: scanStatus === 'failed' ? 'source unreachable' : null,
    }));
  });

  it('does not call a scan that has never run an empty partner list', async () => {
    // WHY: no run row means the scan has not arrived. partners: [] is not
    // "no consulting partners". Jarvis would report a settled empty book.
    scanStatus = 'never';
    const out = await answer();

    expect(out.note).toBe(CHECKING);
    expect(out).not.toHaveProperty('partners');
    expect(out).not.toHaveProperty('evidence');
    expect(JSON.stringify(out)).not.toMatch(/not found/i);
    expect(JSON.stringify(out)).not.toMatch(/No consulting partners/);
    expect(out.account).toBe('Harbor Synthetic');
  });

  it('does not call a queued or running scan an empty partner list', async () => {
    // WHY: a scan still in flight has no rows yet. That is not a scan that
    // found no consulting partners.
    for (const status of ['queued', 'running'] as const) {
      scanStatus = status;
      const out = await answer();
      expect(out.note).toBe(CHECKING);
      expect(out).not.toHaveProperty('partners');
      expect(JSON.stringify(out)).not.toMatch(/not found/i);
    }
  });

  it('does not call a failed scan with no rows an empty partner list', async () => {
    // WHY: a failed scan is not evidence that no consulting partners exist.
    // The answer says the load failed. It does not say the account is missing.
    scanStatus = 'failed';
    const out = await answer();

    expect(out.note).toBe(FAILED);
    expect(out.read).toBe('failed');
    expect(out).not.toHaveProperty('partners');
    expect(out).not.toHaveProperty('evidence');
    expect(JSON.stringify(out)).not.toMatch(/not found/i);
    expect(JSON.stringify(out)).not.toMatch(/No consulting partners/);
  });

  it('still returns an empty list after a settled scan found none', async () => {
    // WHY: a finished scan with no rows is an empty book. A slow or failed
    // scan must not be dressed up as that outcome, and this one must.
    scanStatus = 'ok';
    const out = await answer();

    expect(out.partners).toEqual([]);
    expect(out.read).toBe('ready');
    expect(out.note).toMatch(/no_evidence/);
    expect(out.note).not.toBe(CHECKING);
    expect(out.note).not.toBe(FAILED);
  });

  it('still returns an empty list when public fetch was not configured', async () => {
    // WHY: not_configured means the internal pass finished and public news
    // was skipped. That is a settled look, not a scan that has not arrived.
    scanStatus = 'not_configured';
    const out = await answer();

    expect(out.partners).toEqual([]);
    expect(out.read).toBe('ready');
    expect(out.note).not.toBe(CHECKING);
  });

  it('still returns a partner the scan already stored', async () => {
    // WHY: rows on disk are the payload. A later failed or running rescan
    // must not hide the partner that already arrived.
    rows = [row()];
    for (const status of ['ok', 'failed', 'running'] as const) {
      scanStatus = status;
      const out = await answer();
      expect(out.partners?.[0]?.firmKey).toBe('kpmg');
      expect(out.note).not.toBe(CHECKING);
      expect(out.note).not.toBe(FAILED);
    }
  });
});
