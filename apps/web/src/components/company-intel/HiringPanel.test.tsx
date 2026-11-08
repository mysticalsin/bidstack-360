import type { AccountHiringIntel } from '@bidstack/shared';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { HiringPanel } from './IntelPanels';

const posting = (id: string, title: string, fn: string, seniority: string | null, skills: string[] = []) => ({
  id,
  title,
  department: null,
  function: fn,
  location: 'Paris',
  seniority,
  skills,
  postedAt: '2026-11-01T00:00:00Z',
  url: null,
  source: 'greenhouse',
  sample: false,
});

const hiring: AccountHiringIntel = {
  companyId: 'c1',
  summary: {
    openRoles: 96,
    posted30: 40,
    postedPrev30: 20,
    posted90: 80,
    postedPrev90: 60,
    trend30Pct: 100,
    trend90Pct: 33,
    monthly: [10, 10, 10, 10, 20, 20],
    byFunction: [
      { key: 'data', label: 'Data', count: 48 },
      { key: 'sales', label: 'Sales', count: 24 },
    ],
    skills: [
      { skill: 'Snowflake', count: 24, theme: 'data_ai' },
      { skill: 'Azure', count: 12, theme: 'cloud' },
    ],
    sources: ['greenhouse'],
  },
  postings: [
    posting('1', 'Data engineer, Snowflake', 'data', 'Senior', ['Snowflake']),
    posting('2', 'Azure platform engineer', 'infrastructure', 'Mid'),
    posting('3', 'Account executive', 'sales', null),
  ],
  sample: false,
};

describe('HiringPanel detail', () => {
  afterEach(cleanup);

  it('keeps the open roles count, function mix and skills', () => {
    render(<HiringPanel h={hiring} />);
    expect(screen.getByTestId('intel-open-roles').textContent).toContain('96');
    expect(screen.getByText('Function mix')).toBeTruthy();
    expect(screen.getByText('Skills')).toBeTruthy();
  });

  it('shows shares of open roles for functions and tech', () => {
    render(<HiringPanel h={hiring} />);
    expect(screen.getByRole('button', { name: /^Data: 48, 50% of open roles/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Snowflake: 24, 25% of open roles/ })).toBeTruthy();
    expect(screen.getByTestId('hiring-focus').textContent).toContain('Tech named most: Snowflake 25%, Azure 13% of open roles.');
    expect(screen.getByTestId('hiring-focus').textContent).toMatch(/Where we fit: /);
  });

  it('lists each role with its seniority and skills', () => {
    render(<HiringPanel h={hiring} />);
    const roles = screen.getByTestId('hiring-postings');
    expect(within(roles).getByLabelText('Data engineer, Snowflake: seniority and skills').textContent).toContain('Senior');
    expect(within(roles).getByLabelText('Azure platform engineer: seniority and skills').textContent).toContain('Azure');
    expect(screen.getByText(/Listing the latest 3 of 96 open roles/)).toBeTruthy();
  });

  it('names its source and marks the practice fit as inferred', () => {
    render(<HiringPanel h={hiring} />);
    expect(screen.getByTestId('hiring-focus-source').textContent).toMatch(/Source: 96 open roles from /);
    expect(within(screen.getByTestId('hiring-focus')).getByText('Inferred')).toBeTruthy();
  });

  it('filters the roles by a tech and clears the filter', () => {
    render(<HiringPanel h={hiring} />);
    fireEvent.click(screen.getByRole('button', { name: /^Azure: 12/ }));
    const roles = screen.getByTestId('hiring-postings');
    expect(within(roles).getByText('Azure platform engineer')).toBeTruthy();
    expect(within(roles).queryByText('Account executive')).toBeNull();
    expect(screen.getByText('Roles: Azure')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Show every role' }));
    expect(within(screen.getByTestId('hiring-postings')).getByText('Account executive')).toBeTruthy();
  });
});

describe('HiringPanel shares and company changes', () => {
  afterEach(cleanup);

  it('shows the base of every share next to it', () => {
    render(<HiringPanel h={hiring} />);
    expect(screen.getByTestId('share-unit-function').textContent).toBe('Percent of open roles');
    expect(screen.getByTestId('share-unit-theme').textContent).toBe('Percent of 3 postings');
    expect(screen.getByTestId('share-unit-seniority').textContent).toBe('Percent of 3 postings');
  });

  it('clears the role filter when the panel moves to another company', () => {
    const { rerender } = render(<HiringPanel h={hiring} />);
    fireEvent.click(screen.getByRole('button', { name: /^Azure: 12/ }));
    expect(screen.getByText('Roles: Azure')).toBeTruthy();

    rerender(<HiringPanel h={{ ...hiring, companyId: 'c2' }} />);

    expect(screen.queryByText('Roles: Azure')).toBeNull();
    expect(within(screen.getByTestId('hiring-postings')).getByText('Account executive')).toBeTruthy();
  });

  it('keeps a filter that still matches a refresh of the same company', () => {
    const { rerender } = render(<HiringPanel h={hiring} />);
    fireEvent.click(screen.getByRole('button', { name: /^Azure: 12/ }));
    const refreshed = {
      ...hiring,
      postings: [posting('2', 'Azure platform engineer', 'infrastructure', 'Mid', ['Azure'])],
    };
    rerender(<HiringPanel h={refreshed} />);
    expect(screen.getByText('Roles: Azure')).toBeTruthy();
    expect(within(screen.getByTestId('hiring-postings')).getByText('Azure platform engineer')).toBeTruthy();
  });

  it('drops a filter that matches nothing in a same-company refresh', () => {
    const { rerender } = render(<HiringPanel h={hiring} />);
    fireEvent.click(screen.getByRole('button', { name: /^Azure: 12/ }));
    const refreshed = {
      ...hiring,
      postings: [posting('3', 'Account executive', 'sales', null)],
    };
    rerender(<HiringPanel h={refreshed} />);
    expect(screen.queryByText('Roles: Azure')).toBeNull();
    expect(within(screen.getByTestId('hiring-postings')).getByText('Account executive')).toBeTruthy();
  });

  it('collapses an expanded list when the same company is refreshed', () => {
    const many = {
      ...hiring,
      postings: Array.from({ length: 10 }, (_, index) =>
        posting(String(index), `Role ${index}`, 'infrastructure', null, ['Azure']),
      ),
    };
    const { rerender } = render(<HiringPanel h={many} />);
    fireEvent.click(screen.getByRole('button', { name: /^Azure: 12/ }));
    fireEvent.click(screen.getByRole('button', { name: /Show all 10 roles/ }));
    expect(within(screen.getByTestId('hiring-postings')).getByText('Role 9')).toBeTruthy();
    rerender(<HiringPanel h={{
      ...many,
      postings: Array.from({ length: 10 }, (_, index) =>
        posting(`b${index}`, `Next ${index}`, 'infrastructure', null, ['Azure']),
      ),
    }} />);
    expect(screen.getByText('Roles: Azure')).toBeTruthy();
    expect(within(screen.getByTestId('hiring-postings')).queryByText('Next 9')).toBeNull();
    expect(within(screen.getByTestId('hiring-postings')).getByText('Next 0')).toBeTruthy();
  });

  it('collapses the list when the filter is cleared', () => {
    const many = {
      ...hiring,
      postings: Array.from({ length: 10 }, (_, index) =>
        posting(String(index), `Role ${index}`, 'infrastructure', null, ['Azure']),
      ),
    };
    render(<HiringPanel h={many} />);
    fireEvent.click(screen.getByRole('button', { name: /^Azure: 12/ }));
    fireEvent.click(screen.getByRole('button', { name: /Show all 10 roles/ }));
    expect(within(screen.getByTestId('hiring-postings')).getByText('Role 9')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Show every role' }));
    expect(within(screen.getByTestId('hiring-postings')).queryByText('Role 9')).toBeNull();
    expect(within(screen.getByTestId('hiring-postings')).getByText('Role 0')).toBeTruthy();
  });
});
