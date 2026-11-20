import { describe, expect, it } from 'vitest';

import { serializeCompany } from './company-enrichment.service.js';
import { acceptTechnicalStackSuggestion, buildTechnicalStackState } from './technical-stack.service.js';

const AT = '2026-11-07T12:00:00.000Z';

function row(providerMetadata: Record<string, unknown>) {
  return {
    id: 'e1',
    tradeName: 'Acme',
    legalName: 'Acme',
    domain: 'acme.com',
    website: 'https://acme.com/',
    industryCodes: [],
    providerMetadata,
    employeeCount: null,
    annualRevenueMicros: null,
    status: 'active',
    registryIds: {},
    formerNames: [],
    incorporationDate: null,
    logoUrl: null,
    logoSource: null,
    confidenceBps: 7200,
    sourceAttribution: [],
    updatedAt: new Date(AT),
  };
}

const openTechStack = {
  version: 1,
  checkedAt: AT,
  sample: false,
  apolloFallback: 'not_needed',
  lanes: [{ lane: 'dns', status: 'found', count: 1, detail: null, checkedAt: AT }],
  items: [
    { name: 'Microsoft 365', category: 'Collaboration', lane: 'dns', source: 'open_data:dns', confidence: 0.95, evidence: { url: null, record: 'MX acme.com x.mail.protection.outlook.com', observedAt: AT } },
    { name: 'Salesforce', category: 'CRM', lane: 'jobs', source: 'open_data:jobs', confidence: 0.6, evidence: { url: null, record: 'Named in 1 of 3 public job postings', observedAt: AT } },
  ],
};

describe('open data technologies in the provider stack', () => {
  it('serializes open data items with evidence next to older provider sources', () => {
    const company = serializeCompany(
      row({
        openTechStack,
        seamless: { technologies: ['SAP'] },
        meetingTechStack: [{ label: 'Apollo technologies', items: [{ name: 'Salesforce', source: 'enrichment:apollo', confidence: 0.82 }] }],
      }),
    );
    const items = (company.technicalStack ?? []).flatMap((c) => c.items);
    expect(items.map((i) => i.name).sort()).toEqual(['Microsoft 365', 'SAP', 'Salesforce']);
    expect(items.find((i) => i.name === 'Microsoft 365')).toMatchObject({ source: 'open_data:dns', evidence: { observedAt: AT } });
    expect(items.find((i) => i.name === 'Salesforce')!.source).toBe('enrichment:apollo');
  });

  it('ignores a malformed snapshot instead of failing the account', () => {
    const company = serializeCompany(row({ openTechStack: { version: 9, items: 'x' } }));
    expect(company.technicalStack).toEqual([]);
  });

  it('keeps evidence through normalization and acceptance', () => {
    const company = serializeCompany(row({ openTechStack }));
    const state = buildTechnicalStackState({ companyKey: 'acme', providerStack: company.technicalStack ?? [], overrideValue: { stack: [], dismissedSuggestionIds: [] } });
    const m365 = state.suggestions.find((s) => s.item.name === 'Microsoft 365')!;
    expect(m365.item.evidence?.record).toContain('MX');
    const accepted = acceptTechnicalStackSuggestion(state, m365.id)!;
    expect(accepted[0]!.items[0]).toMatchObject({ source: 'manual:accepted:open_data:dns', confidence: 1, evidence: { record: expect.stringContaining('MX') } });
  });
});
