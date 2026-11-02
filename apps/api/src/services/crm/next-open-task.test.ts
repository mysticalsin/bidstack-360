import { readFileSync } from 'node:fs';

import { describe, expect, it, vi } from 'vitest';

import type { AccessScope } from '../../lib/access-scope.js';
import {
  fetchNextOpenTask,
  nextOpenTaskQuery,
  pickNextOpenTask,
  type NextOpenTaskCandidate,
} from './next-open-task.js';

const ORG = '11111111-1111-4111-8111-111111111111';
const ACME = '22222222-2222-4222-8222-222222222222';
const OTHER = '33333333-3333-4333-8333-333333333333';
const USER = '44444444-4444-4444-8444-444444444444';

const UNRESTRICTED: AccessScope = { unrestricted: true, countries: [], userId: USER };
const RESTRICTED: AccessScope = { unrestricted: false, countries: ['FR'], userId: USER };

function task(
  overrides: Partial<NextOpenTaskCandidate> & Pick<NextOpenTaskCandidate, 'id' | 'dueDate' | 'status'>,
): NextOpenTaskCandidate {
  return {
    title: overrides.id,
    accountId: ACME,
    opportunityCompanyId: null,
    customer: 'Acme',
    ...overrides,
  };
}

describe('next open task for the accounts in view', () => {
  it('does not choose a customer-name match or a done task, and an earlier due date wins', () => {
    // WHY: a matching customer string, a finished task, or a later due date
    // used to become "next" and hide the real earliest open task.
    const rows: NextOpenTaskCandidate[] = [
      task({
        id: 'undated',
        status: 'open',
        dueDate: null,
        accountId: ACME,
        customer: 'Acme',
      }),
      task({
        id: 'later',
        status: 'open',
        dueDate: '2026-12-01',
        accountId: ACME,
        customer: 'Acme',
      }),
      task({
        id: 'by-name',
        status: 'open',
        dueDate: '2020-01-02',
        accountId: null,
        opportunityCompanyId: null,
        customer: 'Acme',
      }),
      task({
        id: 'done-early',
        status: 'done',
        dueDate: '2020-01-01',
        accountId: ACME,
        customer: 'Acme',
      }),
      task({
        id: 'other-company',
        status: 'open',
        dueDate: '2020-01-03',
        accountId: OTHER,
        opportunityCompanyId: OTHER,
        customer: 'Acme',
      }),
      task({
        id: 'null-company',
        status: 'in_progress',
        dueDate: '2020-01-04',
        accountId: null,
        opportunityCompanyId: null,
        customer: 'Acme',
      }),
      task({
        id: 'via-deal',
        status: 'in_progress',
        dueDate: '2026-02-01',
        accountId: null,
        opportunityCompanyId: ACME,
        customer: 'Other label',
      }),
      task({
        id: 'account-later',
        status: 'open',
        dueDate: '2026-02-02',
        accountId: ACME,
        opportunityCompanyId: null,
        customer: 'Not the label',
      }),
    ];

    const next = pickNextOpenTask([ACME, 'acme-slug', ACME], rows);
    expect(next?.id).toBe('via-deal');
    expect(next?.dueDate).toBe('2026-02-01');
    expect(next?.companyId).toBe(ACME);
    expect(pickNextOpenTask([ACME], [rows[2]!, rows[3]!, rows[4]!, rows[5]!])).toBeNull();
    expect(pickNextOpenTask([OTHER], [rows[6]!])?.id).not.toBe('via-deal');
    expect(
      pickNextOpenTask(
        [ACME],
        [
          task({ id: 'dated', status: 'blocked', dueDate: '2026-05-01', accountId: ACME }),
          task({ id: 'no-date', status: 'open', dueDate: null, accountId: ACME }),
        ],
      )?.id,
    ).toBe('dated');
  });

  it('loads every open task by company id and keeps the caller inside their scope', () => {
    // WHY: joining on the customer name, or reading one page of recent tasks,
    // would pick a later task and still call it the next one for this view.
    const query = nextOpenTaskQuery(ORG, [ACME, 'acme-slug', ACME, ''], UNRESTRICTED);
    expect(query).not.toBeNull();
    const text = query!.text;
    expect(text).toContain('task.account_id IN');
    expect(text).toContain('o.company_id IN');
    expect(text).toContain("task.status::text <> 'done'");
    expect(text).toContain('task.deleted_at IS NULL');
    expect(text).toContain('o.deleted_at IS NULL');
    expect(text).toContain('o.id IS NULL');
    expect(text).toContain('task.org_id =');
    expect(text).not.toContain('key_account_owner_id');
    expect(text).not.toContain('customer');
    expect(text).not.toMatch(/\bLIMIT\b/i);
    expect(text).not.toMatch(/\bOFFSET\b/i);
    expect(query!.values).toContain(ACME);
    expect(query!.values).toContain(ORG);
    expect(query!.values).not.toContain('acme-slug');
    expect(query!.values).not.toContain('Acme');
    expect(query!.values).not.toContain(OTHER);

    const restricted = nextOpenTaskQuery(ORG, [ACME], RESTRICTED);
    expect(restricted).not.toBeNull();
    expect(restricted!.text).toContain('LEFT JOIN territories t');
    expect(restricted!.text).toContain('o.owner_id =');
    expect(restricted!.text).toContain('o.country = ANY');
    expect(restricted!.text).toContain('t.country_codes');
    expect(restricted!.text).toContain('co.key_account_owner_id =');
    expect(restricted!.text).toContain('co.country_code = ANY');
    expect(restricted!.text).toContain('vo.owner_id =');
    expect(restricted!.text).toContain('vt.country_codes');
    expect(restricted!.values).toContain(USER);
    expect(restricted!.values).toContain('FR');
    expect(nextOpenTaskQuery(ORG, ['acme-slug'], UNRESTRICTED)).toBeNull();
  });

  it('returns the earlier company task when the page would have started at a done or name match', async () => {
    const queryRaw = vi.fn(async () => [
      {
        id: 'done-early',
        title: 'Finished first',
        status: 'done',
        dueDate: '2020-01-01',
        accountId: ACME,
        opportunityCompanyId: null,
      },
      {
        id: 'by-name',
        title: 'Same customer label',
        status: 'open',
        dueDate: '2020-01-02',
        accountId: null,
        opportunityCompanyId: null,
      },
      {
        id: 'later',
        title: 'Later open task',
        status: 'open',
        dueDate: '2026-12-01',
        accountId: ACME,
        opportunityCompanyId: null,
      },
      {
        id: 'earlier',
        title: 'Earlier open task',
        status: 'in_progress',
        dueDate: new Date('2026-02-01T00:00:00.000Z'),
        accountId: null,
        opportunityCompanyId: ACME,
      },
    ]);
    const read = await fetchNextOpenTask({ $queryRaw: queryRaw }, ORG, [ACME, 'acme'], UNRESTRICTED);
    expect(queryRaw).toHaveBeenCalledOnce();
    expect(read.complete).toBe(true);
    expect(read.task).toEqual({
      id: 'earlier',
      title: 'Earlier open task',
      dueDate: '2026-02-01',
      companyId: ACME,
    });
  });
});

describe('next open task route', () => {
  it('reads the caller scope and does not build the task from the dashboard page', () => {
    const src = readFileSync(new URL('../../routes/crm/dashboard.ts', import.meta.url), 'utf8');
    const start = src.indexOf("'/crm/accounts/next-open-task'");
    const end = src.indexOf("'/crm/release-score'", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const body = src.slice(start, end);
    expect(body).toContain('getAccessScope');
    expect(body).toContain('fetchNextOpenTask');
    expect(body).toContain("permission: 'companies:read'");
    expect(body).not.toContain('buildDashboardSnapshot');
    expect(body).not.toContain('findMany');
    expect(body).not.toMatch(/take:\s*(50|100|500|1000)/);
    expect(body).not.toContain('proposals:approve');
  });
});
