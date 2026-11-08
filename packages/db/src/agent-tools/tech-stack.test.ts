import { beforeEach, describe, expect, it, vi } from 'vitest';

const companyFindFirst = vi.fn();
const enrichmentFindFirst = vi.fn();
const overrideFindUnique = vi.fn();
vi.mock('../index.js', () => ({
  prisma: {
    company: { findFirst: (...a: unknown[]) => companyFindFirst(...a) },
    companyEnrichment: { findFirst: (...a: unknown[]) => enrichmentFindFirst(...a) },
    companyFieldOverride: { findUnique: (...a: unknown[]) => overrideFindUnique(...a) },
  },
}));

import { agentTools } from './index.js';

const CHECKED = '2026-11-07T10:00:00.000Z';
const ctx = { orgId: 'org-1' };
const COMPANY = { id: '11111111-1111-4111-8111-111111111111', name: 'DNB Bank' };

const snapshot = {
  version: 1,
  checkedAt: CHECKED,
  sample: false,
  apolloFallback: 'not_needed',
  items: [
    { name: 'Microsoft 365', category: 'Collaboration', lane: 'dns', source: 'open_data:dns', confidence: 0.95, evidence: { url: null, record: 'MX x.mail.protection.outlook.com <b>', observedAt: CHECKED } },
    { name: 'Jira', category: 'DevOps', lane: 'ct', source: 'open_data:ct', confidence: 0.65, evidence: { url: 'https://crt.sh/?q=jira.dnb.no', record: 'Certificate for jira.dnb.no', observedAt: CHECKED } },
  ],
  lanes: [
    { lane: 'dns', status: 'found', count: 1, detail: null, checkedAt: CHECKED },
    { lane: 'ct', status: 'found', count: 1, detail: null, checkedAt: CHECKED },
    { lane: 'web', status: 'failed', count: 0, detail: 'Homepage answered HTTP 403, likely bot protection', checkedAt: CHECKED },
    { lane: 'jobs', status: 'empty', count: 0, detail: null, checkedAt: CHECKED },
    { lane: 'github', status: 'skipped', count: 0, detail: 'No public GitHub organisation linked', checkedAt: CHECKED },
  ],
};

describe('company_tech_stack agent tool', () => {
  beforeEach(() => {
    companyFindFirst.mockReset().mockResolvedValue(COMPANY);
    enrichmentFindFirst.mockReset().mockResolvedValue({
      providerMetadata: {
        openTechStack: snapshot,
        meetingTechStack: [{ label: 'Apollo technologies', items: [{ name: 'Salesforce', source: 'apollo_io', confidence: 0.82 }] }],
      },
    });
    overrideFindUnique.mockReset().mockResolvedValue(null);
  });

  it('is a read tool gated by companies:read', () => {
    const tool = agentTools.company_tech_stack;
    expect(tool.kind).toBe('read');
    expect(tool.permission).toBe('companies:read');
  });

  it('stays inside the caller org', async () => {
    await agentTools.company_tech_stack.handler({ companyId: COMPANY.id }, ctx);
    expect(companyFindFirst.mock.calls[0]![0].where).toMatchObject({ orgId: 'org-1', id: COMPANY.id, deletedAt: null });
    expect(enrichmentFindFirst.mock.calls[0]![0].where).toMatchObject({ orgId: 'org-1', normalizedName: 'dnb-bank' });
    companyFindFirst.mockResolvedValueOnce(null);
    await expect(agentTools.company_tech_stack.handler({ companyName: 'Other Org Co' }, ctx)).rejects.toThrow(/not found/i);
  });

  it('returns cited technologies, coverage gaps and the Apollo decision, markup stripped', async () => {
    const out = (await agentTools.company_tech_stack.handler({ companyId: COMPANY.id }, ctx)) as {
      technologies: Array<{ name: string; source: string; evidence: string | null; evidenceUrl: string | null }>;
      coverage: { found: string[]; nothingFound: string[]; notChecked: string[]; couldNotReach: string[] };
      apolloFallback: string | null;
      citations: Array<{ kind: string; href: string }>;
      note: string;
    };
    expect(out.technologies.map((t) => [t.name, t.source])).toEqual([
      ['Microsoft 365', 'DNS'],
      ['Salesforce', 'Apollo'],
      ['Jira', 'Cert'],
    ]);
    expect(out.technologies[0]!.evidence).toBe('MX x.mail.protection.outlook.com');
    expect(out.technologies[2]!.evidenceUrl).toBe('https://crt.sh/?q=jira.dnb.no');
    expect(out.coverage).toEqual({ found: ['DNS 1', 'Cert 1'], nothingFound: ['Jobs'], notChecked: ['GitHub'], couldNotReach: ['Website'] });
    expect(out.apolloFallback).toBe('not_needed');
    expect(out.citations[0]).toEqual({ kind: 'account', label: 'DNB Bank', href: `/accounts/${COMPANY.id}` });
    expect(out.note).toMatch(/public sources/i);
    expect(JSON.stringify(out)).not.toMatch(/@|phone|email/i);
  });

  it('says plainly when nothing has been checked yet', async () => {
    enrichmentFindFirst.mockResolvedValueOnce(null);
    const out = (await agentTools.company_tech_stack.handler({ companyName: 'DNB Bank' }, ctx)) as { technologies: unknown[]; coverage: unknown; note: string };
    expect(out.technologies).toEqual([]);
    expect(out.coverage).toBeNull();
  });
});
