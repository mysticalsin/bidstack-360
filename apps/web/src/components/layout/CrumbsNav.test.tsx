// The trail is only useful if the list word is a real link and the open
// customer is the current page. A stored name must not become the href.
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { CrumbsNav } from './CrumbsNav';
import { buildCrumbs, type CrumbCopy } from './crumbs';

const HELIOS = '11111111-1111-4111-8111-111111111111';

const copy: CrumbCopy = {
  portfolio: 'Portfolio',
  detail: 'Detail',
  orgChart: 'Org chart',
  sectionLabel: (segment) => (segment === 'accounts' ? 'Accounts' : segment),
  accountName: () => 'javascript:alert(1)',
};

describe('CrumbsNav', () => {
  it('links the list and the account, and marks the org chart as the current page', () => {
    const crumbs = buildCrumbs(`/accounts/${HELIOS}/org-chart`, copy);
    render(
      <MemoryRouter>
        <CrumbsNav crumbs={crumbs} label="Breadcrumb" />
      </MemoryRouter>,
    );

    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Accounts' }).getAttribute('href')).toBe('/accounts');
    const account = screen.getByRole('link', { name: 'javascript:alert(1)' });
    expect(account.getAttribute('href')).toBe(`/accounts/${HELIOS}`);
    expect(account.getAttribute('href')).not.toContain('javascript:');
    const here = screen.getByText('Org chart');
    expect(here.getAttribute('aria-current')).toBe('page');
    expect(here.closest('a')).toBeNull();
  });
});
