import { readFileSync } from 'node:fs';

import { describe, expect, it, vi } from 'vitest';

import type { AccessScope } from '../../lib/access-scope.js';
import {
  countQuietAccounts,
  fetchQuietAccounts,
  quietAccountQuery,
  quietBefore,
  type QuietAccountActivity,
} from './quiet-accounts.js';

const ORG = '11111111-1111-4111-8111-111111111111';
const ACME = '22222222-2222-4222-8222-222222222222';
const BETA = '33333333-3333-4333-8333-333333333333';
const USER = '44444444-4444-4444-8444-444444444444';

/** Afternoon UTC. The KAM cutoff is that morning minus 13 UTC dates. */
const NOW = new Date('2026-11-15T15:00:00.000Z');

const UNRESTRICTED: AccessScope = { unrestricted: true, countries: [], userId: USER };
const RESTRICTED: AccessScope = { unrestricted: false, countries: ['FR'], userId: USER };

function activity(
  overrides: Partial<QuietAccountActivity> & Pick<QuietAccountActivity, 'occurredAt'>,
): QuietAccountActivity {
  return {
    accountId: ACME,
    opportunityCompanyId: null,
    customer: 'Acme',
    ...overrides,
  };
}

describe('quiet accounts in this view', () => {
  it('counts an account quiet when its latest activity is before the KAM stale cutoff', () => {
    // WHY: staleBefore(14) is UTC midnight (14-1) days ago, so an afternoon
    // activity 14 UTC dates back is quiet and midnight on the cutoff day is
    // not. The line is accounts. A customer name does not refresh one.
    expect(NOW.toISOString()).toBe('2026-11-15T15:00:00.000Z');
    expect(quietBefore(NOW).toISOString()).toBe('2026-11-02T00:00:00.000Z');

    expect(
      countQuietAccounts(
        [ACME],
        [activity({ occurredAt: '2026-11-01T18:00:00.000Z', accountId: ACME, customer: 'Acme' })],
        NOW,
      ),
    ).toBe(1);

    expect(
      countQuietAccounts(
        [ACME],
        [activity({ occurredAt: '2026-11-02T00:00:00.000Z', accountId: ACME, customer: 'Nope' })],
        NOW,
      ),
    ).toBe(0);

    expect(countQuietAccounts([ACME], [], NOW)).toBe(1);

    expect(
      countQuietAccounts(
        [ACME, 'Acme'],
        [
          activity({ occurredAt: '2026-11-01T18:00:00.000Z', accountId: ACME, customer: 'Acme' }),
          activity({
            occurredAt: '2026-11-14T12:00:00.000Z',
            accountId: 'Acme',
            opportunityCompanyId: null,
            customer: 'Acme',
          }),
        ],
        NOW,
      ),
    ).toBe(2);

    expect(
      countQuietAccounts(
        [ACME, BETA],
        [
          activity({ occurredAt: '2026-11-01T18:00:00.000Z', accountId: ACME }),
          activity({ occurredAt: '2026-10-01T00:00:00.000Z', accountId: ACME }),
          activity({
            occurredAt: '2026-11-02T00:00:00.000Z',
            accountId: null,
            opportunityCompanyId: BETA,
            customer: 'Beta Co',
          }),
        ],
        NOW,
      ),
    ).toBe(1);
  });

  it('reads the full company set by UUID and does not widen it', () => {
    // WHY: a customer-name join, or one page of events, would refresh the
    // wrong accounts and still call the number "this view".
    const query = quietAccountQuery(ORG, [ACME, 'acme-slug', ACME, ''], UNRESTRICTED);
    expect(query).not.toBeNull();
    expect(query!.text).toContain('task.account_id IN');
    expect(query!.text).toContain('o.company_id IN');
    expect(query!.text).toContain('note.company_id IN');
    expect(query!.text).toContain('note.account_id ~*');
    expect(query!.text).not.toContain("<> 'done'");
    expect(query!.text).not.toContain('customer');
    expect(query!.text).not.toMatch(/\bLIMIT\b/i);
    expect(query!.text).not.toMatch(/\bOFFSET\b/i);
    expect(query!.values).not.toContain('Acme');
    expect(query!.values).not.toContain('acme-slug');
    expect(query!.values).toContain(ACME);

    const restricted = quietAccountQuery(ORG, [ACME], RESTRICTED);
    expect(restricted!.text).toContain('o.owner_id =');
    expect(restricted!.text).toContain('o.country = ANY');
    expect(restricted!.text).toContain('t.country_codes');
    expect(restricted!.text).toContain('co.key_account_owner_id =');
    expect(restricted!.text).toContain('vo.company_id = co.id');
    expect(restricted!.text).toContain('vo.owner_id =');
    expect(restricted!.values).toContain(USER);
    expect(restricted!.values).toContain('FR');
    expect(quietAccountQuery(ORG, ['acme-slug'], UNRESTRICTED)).toBeNull();
  });

  it('drops a customer-name event and keeps the cutoff when the rows come from the query', async () => {
    const queryRaw = vi.fn(async () => [
      {
        occurredAt: new Date('2026-11-01T18:00:00.000Z'),
        accountId: ACME,
        opportunityCompanyId: null,
        customer: 'Acme',
      },
      {
        occurredAt: '2026-11-14T12:00:00.000Z',
        accountId: 'Acme',
        opportunityCompanyId: null,
        customer: 'Acme',
      },
      {
        occurredAt: new Date('2026-11-02T00:00:00.000Z'),
        accountId: null,
        opportunityCompanyId: BETA,
      },
    ]);
    const read = await fetchQuietAccounts(
      { $queryRaw: queryRaw },
      ORG,
      [ACME, BETA, 'Acme'],
      UNRESTRICTED,
      NOW,
    );
    expect(queryRaw).toHaveBeenCalledOnce();
    expect(read).toEqual({ accounts: 2, complete: true });
    const sql = queryRaw.mock.calls[0]?.[0] as { text: string; values: unknown[] };
    expect(sql.text).not.toContain('customer');
    expect(sql.text).not.toMatch(/\bLIMIT\b/i);
    expect(sql.values).toContain(ACME);
    expect(sql.values).toContain(BETA);
    expect(sql.values).not.toContain('Acme');
  });
});

describe('quiet account route', () => {
  it('reads the caller scope and does not grant proposals:approve', () => {
    const src = readFileSync(new URL('../../routes/crm/dashboard.ts', import.meta.url), 'utf8');
    const start = src.indexOf("'/crm/accounts/quiet-accounts'");
    expect(start).toBeGreaterThan(-1);
    const body = src.slice(start);
    expect(body).toContain('getAccessScope');
    expect(body).toContain('fetchQuietAccounts');
    expect(body).toContain("permission: 'companies:read'");
    expect(body).not.toContain('buildDashboardSnapshot');
    expect(body).not.toContain('findMany');
    expect(body).not.toMatch(/take:\s*(50|100|500|1000)/);
    expect(body).not.toContain('proposals:approve');
  });
});
