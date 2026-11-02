import { readFileSync } from 'node:fs';

import { describe, expect, it, vi } from 'vitest';

import type { AccessScope } from '../../lib/access-scope.js';
import { nextOpenTaskQuery } from './next-open-task.js';
import {
  countAccountsWithOverdueOpenTask,
  fetchOverdueOpenTaskAccounts,
  overdueOpenTaskQuery,
  type OverdueOpenTaskCandidate,
} from './overdue-open-tasks.js';

const ORG = '11111111-1111-4111-8111-111111111111';
const ACME = '22222222-2222-4222-8222-222222222222';
const BETA = '33333333-3333-4333-8333-333333333333';
const GAMMA = '55555555-5555-4555-8555-555555555555';
const USER = '44444444-4444-4444-8444-444444444444';

/** Fixed clock: 15:00 UTC, so a due date of today is still today. */
const NOW = new Date('2026-11-01T15:00:00.000Z');

const UNRESTRICTED: AccessScope = { unrestricted: true, countries: [], userId: USER };
const RESTRICTED: AccessScope = { unrestricted: false, countries: ['FR'], userId: USER };

function task(
  overrides: Partial<OverdueOpenTaskCandidate> &
    Pick<OverdueOpenTaskCandidate, 'dueDate' | 'status'>,
): OverdueOpenTaskCandidate {
  return {
    accountId: ACME,
    opportunityCompanyId: null,
    customer: 'Acme',
    ...overrides,
  };
}

describe('overdue open tasks for the accounts in view', () => {
  it('counts accounts, and a task due today, a done task, or a customer-name match does not', () => {
    // WHY: the line is accounts in this view that already have an overdue open
    // task. Due today is still today. Yesterday UTC is overdue. A finished
    // task and a matching customer string are not that account's task.
    expect(NOW.toISOString()).toBe('2026-11-01T15:00:00.000Z');

    expect(
      countAccountsWithOverdueOpenTask(
        [ACME],
        [task({ status: 'open', dueDate: '2026-11-01', accountId: ACME, customer: 'Acme' })],
        NOW,
      ),
    ).toBe(0);

    expect(
      countAccountsWithOverdueOpenTask(
        [ACME],
        [task({ status: 'in_progress', dueDate: '2026-10-31', accountId: ACME, customer: 'Nope' })],
        NOW,
      ),
    ).toBe(1);

    expect(
      countAccountsWithOverdueOpenTask(
        [ACME],
        [task({ status: 'blocked', dueDate: '2026-11-01T00:30:00+02:00', accountId: ACME })],
        NOW,
      ),
    ).toBe(1);

    expect(
      countAccountsWithOverdueOpenTask(
        [ACME],
        [task({ status: 'done', dueDate: '2026-10-31', accountId: ACME, customer: 'Acme' })],
        NOW,
      ),
    ).toBe(0);

    expect(
      countAccountsWithOverdueOpenTask(
        [ACME, 'Acme'],
        [
          task({
            status: 'open',
            dueDate: '2026-10-31',
            accountId: null,
            opportunityCompanyId: null,
            customer: 'Acme',
          }),
        ],
        NOW,
      ),
    ).toBe(0);

    expect(
      countAccountsWithOverdueOpenTask(
        [ACME],
        [task({ status: 'open', dueDate: null, accountId: ACME, customer: 'Acme' })],
        NOW,
      ),
    ).toBe(0);

    const rows: OverdueOpenTaskCandidate[] = [
      task({ status: 'open', dueDate: '2026-11-01', accountId: ACME, customer: 'Acme' }),
      task({ status: 'done', dueDate: '2026-10-31', accountId: ACME, customer: 'Acme' }),
      task({ status: 'open', dueDate: null, accountId: ACME, customer: 'Acme' }),
      task({
        status: 'open',
        dueDate: '2026-10-31',
        accountId: null,
        opportunityCompanyId: null,
        customer: 'Acme',
      }),
      task({
        status: 'open',
        dueDate: '2026-10-31',
        accountId: 'Acme',
        opportunityCompanyId: null,
        customer: 'Acme',
      }),
      task({ status: 'in_progress', dueDate: '2026-10-31', accountId: BETA, customer: 'Beta Co' }),
      task({ status: 'open', dueDate: '2026-10-30', accountId: BETA, customer: 'Beta Co' }),
      task({
        status: 'blocked',
        dueDate: '2026-11-01T00:30:00+02:00',
        accountId: null,
        opportunityCompanyId: GAMMA,
        customer: 'Not Gamma',
      }),
    ];

    expect(
      countAccountsWithOverdueOpenTask([ACME, BETA, GAMMA, 'Acme', 'acme-slug', ACME], rows, NOW),
    ).toBe(2);
  });

  it('reads the full next-open-task company set and does not widen it', () => {
    // WHY: a customer-name join, or one page of tasks, would count the wrong
    // accounts and still call the number "this view".
    const query = overdueOpenTaskQuery(ORG, [ACME, 'acme-slug', ACME, ''], UNRESTRICTED);
    const same = nextOpenTaskQuery(ORG, [ACME, 'acme-slug', ACME, ''], UNRESTRICTED);
    expect(query).not.toBeNull();
    expect(query!.text).toBe(same!.text);
    expect(query!.values).toEqual(same!.values);
    expect(query!.text).toContain('task.account_id IN');
    expect(query!.text).toContain('o.company_id IN');
    expect(query!.text).toContain("task.status::text <> 'done'");
    expect(query!.text).not.toContain('customer');
    expect(query!.text).not.toMatch(/\bLIMIT\b/i);
    expect(query!.text).not.toMatch(/\bOFFSET\b/i);
    expect(query!.values).not.toContain('Acme');
    expect(query!.values).not.toContain('acme-slug');

    const restricted = overdueOpenTaskQuery(ORG, [ACME], RESTRICTED);
    const restrictedSame = nextOpenTaskQuery(ORG, [ACME], RESTRICTED);
    expect(restricted!.text).toBe(restrictedSame!.text);
    expect(restricted!.values).toEqual(restrictedSame!.values);
    expect(restricted!.text).toContain('o.owner_id =');
    expect(restricted!.text).toContain('o.country = ANY');
    expect(restricted!.text).toContain('t.country_codes');
    expect(restricted!.text).toContain('co.key_account_owner_id =');
    expect(restricted!.values).toContain(USER);
    expect(restricted!.values).toContain('FR');
    expect(overdueOpenTaskQuery(ORG, ['acme-slug'], UNRESTRICTED)).toBeNull();
  });

  it('drops a task due today and a done task when the rows come from the query', async () => {
    const queryRaw = vi.fn(async () => [
      {
        status: 'open',
        dueDate: '2026-11-01',
        accountId: ACME,
        opportunityCompanyId: null,
        customer: 'Acme',
      },
      {
        status: 'done',
        dueDate: '2026-10-31',
        accountId: ACME,
        opportunityCompanyId: null,
        customer: 'Acme',
      },
      {
        status: 'open',
        dueDate: '2026-10-31',
        accountId: null,
        opportunityCompanyId: null,
        customer: 'Acme',
      },
      {
        status: 'in_progress',
        dueDate: new Date('2026-10-31T00:00:00.000Z'),
        accountId: BETA,
        opportunityCompanyId: null,
      },
      {
        status: 'open',
        dueDate: '2026-10-30',
        accountId: BETA,
        opportunityCompanyId: null,
      },
    ]);
    const read = await fetchOverdueOpenTaskAccounts(
      { $queryRaw: queryRaw },
      ORG,
      [ACME, BETA, 'Acme'],
      UNRESTRICTED,
      NOW,
    );
    expect(queryRaw).toHaveBeenCalledOnce();
    expect(read).toEqual({ accounts: 1, complete: true });
    const sql = queryRaw.mock.calls[0]?.[0] as { text: string; values: unknown[] };
    expect(sql.text).not.toContain('customer');
    expect(sql.text).not.toMatch(/\bLIMIT\b/i);
    expect(sql.values).toContain(ACME);
    expect(sql.values).toContain(BETA);
    expect(sql.values).not.toContain('Acme');
  });
});

describe('overdue task account route', () => {
  it('reads the caller scope and does not grant proposals:approve', () => {
    const src = readFileSync(new URL('../../routes/crm/dashboard.ts', import.meta.url), 'utf8');
    const start = src.indexOf("'/crm/accounts/overdue-task-accounts'");
    expect(start).toBeGreaterThan(-1);
    const body = src.slice(start);
    expect(body).toContain('getAccessScope');
    expect(body).toContain('fetchOverdueOpenTaskAccounts');
    expect(body).toContain("permission: 'companies:read'");
    expect(body).not.toContain('buildDashboardSnapshot');
    expect(body).not.toContain('findMany');
    expect(body).not.toMatch(/take:\s*(50|100|500|1000)/);
    expect(body).not.toContain('proposals:approve');
  });
});
