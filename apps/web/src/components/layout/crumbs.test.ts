// A salesperson opens a customer from Accounts. The top bar must name that
// customer and the word Accounts must go back to the list. An id we have
// never opened stays "Detail" — the bar does not invent a company. The
// stored name is text only; the link is always a path we built.
import { describe, expect, it } from 'vitest';

import { accountCrumbName, buildCrumbs, type CrumbCopy } from './crumbs';

const HELIOS = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

function copy(accountName?: CrumbCopy['accountName']): CrumbCopy {
  return {
    portfolio: 'Portfolio',
    detail: 'Detail',
    orgChart: 'Org chart',
    sectionLabel: (segment) =>
      ({
        accounts: 'Accounts',
        opportunities: 'Opportunities',
        agreements: 'Agreements',
        companies: 'Companies',
        leads: 'Leads',
        settings: 'Settings',
        'meeting-intel': 'Meeting-intel',
      })[segment] ?? segment,
    accountName,
  };
}

describe('account breadcrumb trail', () => {
  it('keeps the accounts list as the current page, with nothing to click', () => {
    expect(buildCrumbs('/accounts', copy())).toEqual([{ label: 'Accounts' }]);
  });

  it('names a known account and links Accounts back to the list', () => {
    // The cockpit visit already stored this name. The bar should use it
    // instead of the generic "Detail" that hides which customer is open.
    const crumbs = buildCrumbs(`/accounts/${HELIOS}`, copy((id) => (id === HELIOS ? 'Helios Grid' : undefined)));

    expect(crumbs).toEqual([
      { label: 'Accounts', to: '/accounts' },
      { label: 'Helios Grid' },
    ]);
  });

  it('leaves an unknown account id as Detail and still links the list', () => {
    const crumbs = buildCrumbs(`/accounts/${HELIOS}`, copy((id) => (id === OTHER ? 'Other Co' : undefined)));

    expect(crumbs).toEqual([
      { label: 'Accounts', to: '/accounts' },
      { label: 'Detail' },
    ]);
    expect(crumbs.some((crumb) => crumb.label === HELIOS)).toBe(false);
  });

  it('treats a blank stored name as unknown', () => {
    const crumbs = buildCrumbs(`/accounts/${HELIOS}`, copy(() => '   '));

    expect(crumbs[1]).toEqual({ label: 'Detail' });
  });

  it('prefers the stored name over a prettified account slug', () => {
    const crumbs = buildCrumbs('/accounts/helios', copy((id) => (id === 'helios' ? 'Helios Grid' : undefined)));

    expect(crumbs).toEqual([
      { label: 'Accounts', to: '/accounts' },
      { label: 'Helios Grid' },
    ]);
  });

  it('keeps a slug with no stored name readable', () => {
    expect(buildCrumbs('/accounts/helios-grid', copy())).toEqual([
      { label: 'Accounts', to: '/accounts' },
      { label: 'Helios grid' },
    ]);
  });

  it('links the account from the org chart and names the chart as the current page', () => {
    const crumbs = buildCrumbs(
      `/accounts/${HELIOS}/org-chart`,
      copy((id) => (id === HELIOS ? 'Helios Grid' : undefined)),
    );

    expect(crumbs).toEqual([
      { label: 'Accounts', to: '/accounts' },
      { label: 'Helios Grid', to: `/accounts/${HELIOS}` },
      { label: 'Org chart' },
    ]);
  });

  it('still links an unnamed account back to its cockpit from the org chart', () => {
    const crumbs = buildCrumbs(`/accounts/${HELIOS}/org-chart`, copy());

    expect(crumbs).toEqual([
      { label: 'Accounts', to: '/accounts' },
      { label: 'Detail', to: `/accounts/${HELIOS}` },
      { label: 'Org chart' },
    ]);
  });

  it('builds those links from the path, never from the stored name', () => {
    const crumbs = buildCrumbs(
      `/accounts/${HELIOS}/org-chart`,
      copy(() => 'javascript:alert(1)'),
    );

    expect(crumbs.map((crumb) => crumb.to)).toEqual(['/accounts', `/accounts/${HELIOS}`, undefined]);
    expect(crumbs[1]?.label).toBe('javascript:alert(1)');
  });

  it('does not label an opportunity with an account name', () => {
    const crumbs = buildCrumbs(`/opportunities/${HELIOS}`, copy(() => 'Helios Grid'));

    expect(crumbs).toEqual([
      { label: 'Opportunities', to: '/opportunities' },
      { label: 'Detail' },
    ]);
  });

  it('links other real lists without inventing a record name', () => {
    expect(buildCrumbs(`/companies/${HELIOS}`, copy())).toEqual([
      { label: 'Companies', to: '/companies' },
      { label: 'Detail' },
    ]);
    expect(buildCrumbs('/agreements/whitespace', copy())).toEqual([
      { label: 'Agreements', to: '/agreements' },
      { label: 'Whitespace' },
    ]);
    expect(buildCrumbs('/leads/new', copy())).toEqual([
      { label: 'Leads', to: '/leads' },
      { label: 'New' },
    ]);
    expect(buildCrumbs('/settings/custom-objects', copy())).toEqual([
      { label: 'Settings', to: '/settings' },
      { label: 'Custom objects' },
    ]);
  });

  it('does not link a section that has no list route', () => {
    const crumbs = buildCrumbs(`/meeting-intel/flags/${HELIOS}`, copy());

    expect(crumbs[0]).toEqual({ label: 'Meeting-intel' });
    expect(crumbs.some((crumb) => crumb.to === '/meeting-intel')).toBe(false);
  });

  it('names the empty path Portfolio', () => {
    expect(buildCrumbs('/', copy())).toEqual([{ label: 'Portfolio' }]);
  });
});

describe('account crumb name', () => {
  const recent = { slug: HELIOS, name: 'Helios Grid', visitedAt: '2026-01-01T00:00:00.000Z' };
  const favorite = { slug: HELIOS, name: 'Old Helios', visitedAt: '2026-01-01T00:00:00.000Z' };

  it('uses the latest visit ahead of a star, and a star when there is no visit', () => {
    // A visit rewrites the name. The star is only the fallback for an account
    // that was saved and not opened again in this browser.
    expect(accountCrumbName(HELIOS, [recent], [favorite])).toBe('Helios Grid');
    expect(accountCrumbName(HELIOS, [], [favorite])).toBe('Old Helios');
  });

  it('skips a blank visit and does not borrow another account', () => {
    expect(accountCrumbName(HELIOS, [{ ...recent, name: '  ' }], [favorite])).toBe('Old Helios');
    expect(accountCrumbName(OTHER, [recent], [favorite])).toBeUndefined();
  });
});
