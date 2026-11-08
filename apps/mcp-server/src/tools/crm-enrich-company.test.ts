import { beforeEach, describe, expect, it, vi } from 'vitest';

const upsert = vi.fn();

vi.mock('@bidstack/db', () => ({
  prisma: {
    companyEnrichment: { upsert },
  },
}));

const { crmEnrichCompany } = await import('./crm-tools.js');

beforeEach(() => {
  upsert.mockReset().mockImplementation(async (args: { create: { legalName: string | null } }) => ({
    id: 'company-1',
    legalName: args.create.legalName,
    domain: null,
    website: null,
    logoUrl: null,
    confidenceBps: 0,
    sourceAttribution: [],
  }));
});

describe('crmEnrichCompany', () => {
  it('does not store the search name as a legal name', async () => {
    // Why: Dust reads this profile back. The typed name is not a legal name.
    const result = await crmEnrichCompany.handler(
      { name: 'DNB Bank' },
      { orgId: 'org-1', userId: 'user-1', scopes: ['write'] } as never,
    );

    const call = upsert.mock.calls[0]?.[0] as {
      create: { legalName: string | null };
      update: Record<string, unknown>;
    };
    expect(call.create.legalName).toBeNull();
    expect(call.update.legalName).toBeUndefined();
    expect(result.legalName).toBeNull();
    expect(result.name).toBe('DNB Bank');
  });
});
