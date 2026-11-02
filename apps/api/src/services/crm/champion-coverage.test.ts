import { readFileSync } from 'node:fs';

import { describe, expect, it, vi } from 'vitest';

import type { AccessScope } from '../../lib/access-scope.js';
import {
  acceptedChampionAccountId,
  accountsMissingAcceptedChampion,
  championFactQuery,
  fetchChampionCoverage,
  type ChampionCoverageFact,
} from './champion-coverage.js';

const ORG = '11111111-1111-4111-8111-111111111111';
const ACME = '22222222-2222-4222-8222-222222222222';
const OTHER = '33333333-3333-4333-8333-333333333333';
const USER = '44444444-4444-4444-8444-444444444444';

const UNRESTRICTED: AccessScope = { unrestricted: true, countries: [], userId: USER };
const RESTRICTED: AccessScope = { unrestricted: false, countries: ['FR'], userId: USER };

function fact(
  overrides: Partial<ChampionCoverageFact> & Pick<ChampionCoverageFact, 'status'>,
): ChampionCoverageFact {
  return {
    kind: 'buying_role',
    linkLabel: 'champion',
    opportunityCompanyId: ACME,
    contactCompanyId: ACME,
    customer: 'Acme',
    ...overrides,
  };
}

describe('accepted champion coverage', () => {
  it('does not hide a missing champion behind another company or an unaccepted fact', () => {
    // WHY: a matching customer string, a contact with no company, or a
    // proposed or dismissed fact used to count as a champion and hide the gap.
    const noise: ChampionCoverageFact[] = [
      fact({ status: 'accepted', opportunityCompanyId: null, contactCompanyId: null, customer: 'Acme' }),
      fact({ status: 'accepted', opportunityCompanyId: OTHER, contactCompanyId: OTHER, customer: 'Acme' }),
      fact({ status: 'accepted', opportunityCompanyId: ACME, contactCompanyId: null, customer: 'Acme' }),
      fact({ status: 'accepted', opportunityCompanyId: ACME, contactCompanyId: OTHER, customer: 'Acme' }),
      fact({ status: 'proposed', opportunityCompanyId: ACME, contactCompanyId: ACME }),
      fact({ status: 'dismissed', opportunityCompanyId: ACME, contactCompanyId: ACME }),
      fact({ status: 'needs_review', opportunityCompanyId: ACME, contactCompanyId: ACME }),
      fact({ status: 'accepted', linkLabel: 'buyer', opportunityCompanyId: ACME, contactCompanyId: ACME }),
      fact({
        status: 'accepted',
        linkLabel: 'Economic buyer',
        opportunityCompanyId: ACME,
        contactCompanyId: ACME,
      }),
    ];

    expect(acceptedChampionAccountId(noise[0]!)).toBeNull();
    // A real champion at the other company stays theirs. It does not cover Acme.
    expect(acceptedChampionAccountId(noise[1]!)).toBe(OTHER);
    expect(noise.slice(2).every((row) => acceptedChampionAccountId(row) === null)).toBe(true);
    expect(accountsMissingAcceptedChampion([ACME], [noise[1]!])).toBe(1);
    expect(accountsMissingAcceptedChampion([ACME, 'acme-slug', ACME], noise)).toBe(2);
    expect(
      accountsMissingAcceptedChampion(
        [OTHER],
        [fact({ status: 'accepted', opportunityCompanyId: ACME, contactCompanyId: ACME, customer: 'Other' })],
      ),
    ).toBe(1);

    const acmeChampion = fact({
      status: 'accepted',
      linkLabel: 'Champion',
      opportunityCompanyId: ACME,
      contactCompanyId: ACME,
    });
    // OTHER already has its own accepted champion in `noise`. Acme's fact covers Acme only.
    expect(accountsMissingAcceptedChampion([ACME, OTHER], [...noise, acmeChampion])).toBe(0);
    expect(accountsMissingAcceptedChampion([OTHER, 'acme-slug'], [acmeChampion])).toBe(2);
    expect(acceptedChampionAccountId(fact({ status: 'accepted', linkLabel: ' Champion ' }))).toBe(ACME);
  });

  it('loads buying-role facts by company id and keeps the caller inside their scope', () => {
    // WHY: joining on the customer name would fill Acme from another company's
    // champion. The query has to stay on the deal's company id, with no page cap.
    const query = championFactQuery(ORG, [ACME, 'key-only-clinic', ACME, ''], UNRESTRICTED);
    expect(query).not.toBeNull();
    const text = query!.text;
    expect(text).toContain("f.kind::text = 'buying_role'");
    expect(text).toContain('o.company_id IN');
    expect(text).toContain('c.company_id');
    expect(text).toContain('f.deleted_at IS NULL');
    expect(text).toContain('o.deleted_at IS NULL');
    expect(text).toContain('c.deleted_at IS NULL');
    expect(text).toContain('f.org_id =');
    expect(text).not.toContain('o.customer');
    expect(text).not.toContain('c.customer');
    expect(text).not.toMatch(/\bLIMIT\b/i);
    expect(query!.values).toContain(ACME);
    expect(query!.values).not.toContain('key-only-clinic');
    expect(query!.values).not.toContain(OTHER);
    expect(query!.values).not.toContain('');

    const restricted = championFactQuery(ORG, [ACME], RESTRICTED);
    expect(restricted).not.toBeNull();
    expect(restricted!.text).toContain('o.owner_id =');
    expect(restricted!.text).toContain('o.country = ANY');
    expect(restricted!.values).toContain(USER);
    expect(restricted!.values).toContain('FR');
    expect(championFactQuery(ORG, ['key-only-clinic'], UNRESTRICTED)).toBeNull();
  });

  it('counts a slug account as missing when the only champion is a customer-name match', async () => {
    const queryRaw = vi.fn(async () => [
      {
        status: 'accepted',
        kind: 'buying_role',
        linkLabel: 'champion',
        opportunityCompanyId: OTHER,
        contactCompanyId: OTHER,
      },
      {
        status: 'proposed',
        kind: 'buying_role',
        linkLabel: 'champion',
        opportunityCompanyId: ACME,
        contactCompanyId: ACME,
      },
      {
        status: 'accepted',
        kind: 'buying_role',
        linkLabel: 'champion',
        opportunityCompanyId: ACME,
        contactCompanyId: null,
      },
    ]);
    const coverage = await fetchChampionCoverage(
      { $queryRaw: queryRaw },
      ORG,
      [ACME, 'acme-slug'],
      UNRESTRICTED,
    );
    expect(queryRaw).toHaveBeenCalledOnce();
    expect(coverage).toEqual({ accounts: 2, missing: 2 });
  });
});

describe('champion coverage route', () => {
  it('reads the caller scope and does not build the count from the dashboard page', () => {
    const src = readFileSync(new URL('../../routes/crm/dashboard.ts', import.meta.url), 'utf8');
    const start = src.indexOf("'/crm/accounts/champion-coverage'");
    const end = src.indexOf("'/crm/release-score'", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const body = src.slice(start, end);
    expect(body).toContain('getAccessScope');
    expect(body).toContain('fetchChampionCoverage');
    expect(body).not.toContain('buildDashboardSnapshot');
    expect(body).not.toContain('findMany');
    expect(body).not.toMatch(/take:\s*(100|500)/);
    expect(body).not.toContain('proposals:approve');
  });
});
