import { describe, expect, it } from 'vitest';

import {
  PEOPLE_MAP_FACT_TAKE,
  contactFactListArgs,
  evidenceFactListArgs,
  linkedDealFactListArgs,
  mergeMapFacts,
} from './people-map.js';

type Row = {
  id: string;
  orgId: string;
  contactId: string;
  opportunityId: string | null;
  companyId: string | null;
  createdAt: string;
};

function matches(row: Row, where: ReturnType<typeof contactFactListArgs>['where']): boolean {
  if (row.orgId !== where.orgId) return false;
  if (!where.contactId.in.includes(row.contactId)) return false;
  if (!where.OR) return true;
  return where.OR.some((branch) => {
    if ('OR' in branch && branch.OR) {
      if (row.opportunityId !== null) return false;
      return branch.OR.some((company) =>
        'companyId' in company ? row.companyId === company.companyId : row.companyId === null,
      );
    }
    const opportunity = branch.opportunityId as string | { in: string[] } | undefined;
    if (opportunity && typeof opportunity === 'object') return opportunity.in.includes(row.opportunityId ?? '');
    return row.opportunityId === opportunity;
  });
}

describe('contact fact query scope', () => {
  const orgId = '00000000-0000-4000-8000-0000000000aa';
  const otherOrg = '00000000-0000-4000-8000-0000000000bb';
  const contactId = '00000000-0000-4000-8000-0000000000c1';
  const dealId = '00000000-0000-4000-8000-0000000000d1';
  const otherDeal = '00000000-0000-4000-8000-0000000000d2';
  const companyId = '00000000-0000-4000-8000-0000000000e1';

  it('keeps a newer deal fact when more than 1000 older unrelated facts exist', () => {
    const older = Array.from({ length: PEOPLE_MAP_FACT_TAKE }, (_, index) => ({
      id: `old-${index}`,
      orgId,
      contactId,
      opportunityId: otherDeal,
      companyId,
      createdAt: `2020-01-01T00:00:${String(index % 60).padStart(2, '0')}.000Z`,
    }));
    const relevant: Row = {
      id: 'new-role',
      orgId,
      contactId,
      opportunityId: dealId,
      companyId,
      createdAt: '2026-11-08T00:00:00.000Z',
    };
    const report: Row = {
      id: 'report',
      orgId,
      contactId,
      opportunityId: null,
      companyId: null,
      createdAt: '2019-01-01T00:00:00.000Z',
    };
    const foreign: Row = {
      id: 'foreign',
      orgId: otherOrg,
      contactId,
      opportunityId: dealId,
      companyId,
      createdAt: '2026-11-08T00:00:00.000Z',
    };
    const args = contactFactListArgs(orgId, [contactId], dealId, companyId);
    const eligible = [foreign, ...older, report, relevant].filter((row) => matches(row, args.where));
    eligible.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const page = eligible.slice(0, args.take);
    expect(args.orderBy).toEqual({ createdAt: 'desc' });
    expect(args.take).toBe(PEOPLE_MAP_FACT_TAKE);
    expect(page.map((row) => row.id)).toContain('new-role');
    expect(page.map((row) => row.id)).toContain('report');
    expect(page.some((row) => row.opportunityId === otherDeal)).toBe(false);
    expect(page.some((row) => row.orgId === otherOrg)).toBe(false);
  });

  it('includes a fact for a deal this map links, and still excludes an unlinked deal', () => {
    const third = '00000000-0000-4000-8000-0000000000d3';
    const args = contactFactListArgs(orgId, [contactId], dealId, companyId);
    const linked: Row = {
      id: 'linked-role',
      orgId,
      contactId,
      opportunityId: otherDeal,
      companyId,
      createdAt: '2026-11-01T00:00:00.000Z',
    };
    const unrelated: Row = {
      id: 'unrelated-role',
      orgId,
      contactId,
      opportunityId: third,
      companyId,
      createdAt: '2026-11-02T00:00:00.000Z',
    };
    const primary = contactFactListArgs(orgId, [contactId], dealId, companyId);
    const older = Array.from({ length: PEOPLE_MAP_FACT_TAKE }, (_, index) => ({
      id: `other-${index}`,
      orgId,
      contactId,
      opportunityId: otherDeal,
      companyId,
      createdAt: `2026-11-0${index % 9}T00:00:00.000Z`,
    }));
    const requested: Row = {
      id: 'requested-role',
      orgId,
      contactId,
      opportunityId: dealId,
      companyId,
      createdAt: '2020-01-01T00:00:00.000Z',
    };
    const primaryPage = [requested, ...older].filter((row) => matches(row, primary.where));
    expect(primaryPage.map((row) => row.id)).toEqual(['requested-role']);
    const supplemental = linkedDealFactListArgs(orgId, [{ contactId, opportunityId: otherDeal }]);
    expect(supplemental.where.OR).toEqual([{ contactId, opportunityId: otherDeal }]);
    expect(supplemental.where.OR).not.toEqual(
      expect.arrayContaining([{ contactId: '00000000-0000-4000-8000-0000000000c9', opportunityId: otherDeal }]),
    );
    expect(matches(linked, args.where)).toBe(false);
    expect(matches(unrelated, args.where)).toBe(false);
  });

  it('keeps an older accepted link when a newer pair fills the display cap', () => {
    const pairA = '00000000-0000-4000-8000-0000000000d1';
    const pairB = '00000000-0000-4000-8000-0000000000d2';
    const evidence = evidenceFactListArgs(
      orgId,
      [contactId],
      pairA,
      [
        { contactId, opportunityId: pairA },
        { contactId, opportunityId: pairB },
      ],
    );
    expect(evidence).not.toHaveProperty('take');
    expect(evidence.distinct).toEqual(['contactId', 'opportunityId', 'status', 'linkLabel']);
    const crowded = Array.from({ length: PEOPLE_MAP_FACT_TAKE }, (_, index) => ({
      id: `new-${index}`,
      contactId,
      kind: 'buying_role' as const,
      status: 'accepted' as const,
      claim: 'new',
      reportsToContactId: null,
      opportunityId: pairA,
      companyId,
      linkLabel: 'buyer',
      evidenceDetail: null,
      observedAt: null,
    }));
    const older = {
      id: 'older-accepted',
      contactId,
      kind: 'buying_role' as const,
      status: 'accepted' as const,
      claim: 'buyer',
      reportsToContactId: null,
      opportunityId: pairB,
      companyId,
      linkLabel: 'buyer',
      evidenceDetail: null,
      observedAt: null,
    };
    const merged = mergeMapFacts(crowded, [], [older]);
    expect(merged.factsTruncated).toBe(true);
    expect(merged.facts[0]?.id).toBe('older-accepted');
    expect(merged.facts[0]?.status).toBe('accepted');
    expect(merged.facts[0]?.opportunityId).toBe(pairB);
    expect(merged.facts).toHaveLength(PEOPLE_MAP_FACT_TAKE + 1);
  });
});
