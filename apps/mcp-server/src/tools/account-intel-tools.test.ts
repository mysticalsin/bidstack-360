import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CompanyIntelSnapshot } from '@bidstack/db';

const NOW = new Date('2026-11-06T12:00:00Z');
const snapshot: CompanyIntelSnapshot = {
  company: { id: '11111111-1111-4111-8111-111111111111', name: 'DNB Bank' },
  years: [
    { fiscalYear: 2024, periodEnd: '2024-12-31', currency: 'NOK', source: 'ESEF (filings.xbrl.org)', sourceUrl: 'https://filings.xbrl.org/a', revenue: 100, operatingMargin: 40, netMargin: 30, capex: 5, rnd: null, acquisitions: null, intangibles: null, debtIssued: null, cash: null, debt: null, headcount: 9000, restructuring: null, sample: false, evidenceId: 'fin:a' },
    { fiscalYear: 2025, periodEnd: '2025-12-31', currency: 'NOK', source: 'ESEF (filings.xbrl.org)', sourceUrl: 'https://filings.xbrl.org/b', revenue: 110, operatingMargin: 42, netMargin: 31, capex: 8, rnd: null, acquisitions: null, intangibles: null, debtIssued: null, cash: null, debt: null, headcount: 9300, restructuring: null, sample: false, evidenceId: 'fin:b' },
  ],
  postings: [{ id: 'j1', title: 'Data engineer <script>alert(1)</script>', function: 'data', department: 'Tech', skills: ['Databricks'], postedAt: new Date(NOW.getTime() - 86_400_000), lastSeenAt: NOW, source: 'greenhouse', url: 'https://boards.greenhouse.io/dnb/jobs/1', location: 'Oslo', seniority: 'senior', fetchedAt: NOW, sample: false }],
  posts: [{ id: 'p1', origin: 'own', kind: 'product', title: 'DNB launches AI assistant', url: 'https://dnb.no/ai', publishedAt: NOW.toISOString(), source: 'newsroom', sourceLabel: 'Company newsroom', sample: false, evidenceId: 'post:p1' }],
  statements: [],
  evidence: [],
  registry: [],
  revenueFallback: null,
  sources: [],
  sample: false,
  now: NOW,
};

const findFirst = vi.fn();
const loadCompanyIntel = vi.fn();
vi.mock('@bidstack/db', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  prisma: { company: { findFirst: (...a: unknown[]) => findFirst(...a) } },
  loadCompanyIntel: (...a: unknown[]) => loadCompanyIntel(...a),
}));

import { accountIntelTools } from './account-intel-tools.js';
import { requiredScopeForTool, tools } from './index.js';

const ctx = { orgId: 'org-1', keyId: 'k', scopes: ['read'] };

describe('account intel MCP tools', () => {
  beforeEach(() => {
    findFirst.mockReset().mockResolvedValue({ id: snapshot.company.id, name: 'DNB Bank' });
    loadCompanyIntel.mockReset().mockResolvedValue(snapshot);
  });

  it('registers four read-only tools in the shared registry', () => {
    for (const name of ['account_direction', 'account_hiring', 'account_financials_summary', 'account_news'] as const) {
      expect(tools[name]).toBe(accountIntelTools[name]);
      expect(requiredScopeForTool(name)).toBe('read');
    }
  });

  it('resolves the account inside the caller org only', async () => {
    await accountIntelTools.account_direction.handler({ companyName: 'DNB Bank' }, ctx);
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ orgId: 'org-1', deletedAt: null }) }));
    findFirst.mockResolvedValue(null);
    await expect(accountIntelTools.account_hiring.handler({ companyName: 'Nobody' }, ctx)).rejects.toThrow(/not found/i);
  });

  it('answers direction with cited claims and fenced record text', async () => {
    const out = (await accountIntelTools.account_direction.handler({ companyId: snapshot.company.id }, ctx)) as { claims: Array<{ evidenceIds: string[] }>; evidence: Array<{ id: string }>; note: string };
    expect(out.claims.length).toBeGreaterThan(0);
    const ids = new Set(out.evidence.map((e) => e.id));
    for (const c of out.claims) for (const id of c.evidenceIds) expect(ids.has(id)).toBe(true);
    expect(out.note).toMatch(/inferred/i);
    const hiring = (await accountIntelTools.account_hiring.handler({ companyId: snapshot.company.id }, ctx)) as { postings: Array<{ title: string }> };
    expect(hiring.postings[0]!.title).not.toContain('<script>');
  });

  it('caps list sizes', async () => {
    loadCompanyIntel.mockResolvedValue({ ...snapshot, posts: Array.from({ length: 80 }, (_, i) => ({ ...snapshot.posts[0]!, id: `p${i}`, evidenceId: `post:p${i}` })) });
    const out = (await accountIntelTools.account_news.handler({ companyId: snapshot.company.id, limit: 100 }, ctx)) as { items: unknown[] };
    expect(out.items.length).toBeLessThanOrEqual(50);
  });
});
