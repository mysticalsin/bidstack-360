// The role and team catalogs on an access-policy rule are authorization lists.
// An unread, paused, or in-flight read must not look like a blank subject, and
// a failed read must not look like a settled empty catalog. A catalog that
// actually arrived empty still says it is empty. A successful list stays.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AccessPolicyRule } from '@bidstack/shared';

type Catalog = {
  status: 'pending' | 'error' | 'success';
  fetchStatus: 'idle' | 'fetching' | 'paused';
  data?: { items: { name: string }[] };
};

const catalog = vi.hoisted(() => ({
  roles: {
    status: 'pending',
    fetchStatus: 'paused',
    data: undefined,
  } as Catalog,
  teams: {
    status: 'pending',
    fetchStatus: 'fetching',
    data: undefined,
  } as Catalog,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, vars?: Record<string, unknown>) =>
      fallback.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(vars?.[name] ?? '')),
  }),
}));

vi.mock('@/hooks/useRoles', () => ({
  useRoles: () => catalog.roles,
}));

vi.mock('@/hooks/useUserGroups', () => ({
  useUserGroups: () => catalog.teams,
}));

import { PolicyBuilder } from './PolicyBuilder';

const OPTIONS = { roles: [] as string[], teams: [] as string[] };

function rule(): AccessPolicyRule {
  return {
    id: 'r1',
    effect: 'deny',
    when: {},
    then: { actions: ['companies:write'], resources: ['companies'] },
    conditions: {},
    except: {},
  };
}

afterEach(() => {
  cleanup();
});

describe('access policy role and team catalogs', () => {
  it('says a paused role list and an in-flight team list have not arrived', () => {
    catalog.roles = { status: 'pending', fetchStatus: 'paused' };
    catalog.teams = { status: 'pending', fetchStatus: 'fetching' };
    render(<PolicyBuilder rules={[rule()]} onChange={vi.fn()} options={OPTIONS} />);

    expect(screen.getAllByText('The role list has not arrived.').length).toBeGreaterThan(0);
    expect(screen.getAllByText('The team list has not arrived.').length).toBeGreaterThan(0);
    expect(screen.queryByText('No roles yet.')).toBeNull();
    expect(screen.queryByText('No teams yet.')).toBeNull();
  });

  it('says an unread role list has not arrived', () => {
    catalog.roles = { status: 'pending', fetchStatus: 'idle' };
    catalog.teams = { status: 'success', fetchStatus: 'idle', data: { items: [] } };
    render(<PolicyBuilder rules={[rule()]} onChange={vi.fn()} options={OPTIONS} />);

    expect(screen.getAllByText('The role list has not arrived.').length).toBeGreaterThan(0);
    expect(screen.getAllByText('No teams yet.').length).toBeGreaterThan(0);
    expect(screen.queryByText('The team list has not arrived.')).toBeNull();
  });

  it('says a failed role list did not load and keeps a settled empty team list empty', () => {
    catalog.roles = { status: 'error', fetchStatus: 'idle' };
    catalog.teams = { status: 'success', fetchStatus: 'idle', data: { items: [] } };
    render(<PolicyBuilder rules={[rule()]} onChange={vi.fn()} options={OPTIONS} />);

    expect(screen.getAllByText('The role list did not load.').length).toBeGreaterThan(0);
    expect(screen.getAllByText('No teams yet.').length).toBeGreaterThan(0);
    expect(screen.queryByText('The role list has not arrived.')).toBeNull();
    expect(screen.queryByText('No roles yet.')).toBeNull();
  });

  it('keeps a successful role and team payload as the checkboxes', () => {
    catalog.roles = {
      status: 'success',
      fetchStatus: 'idle',
      data: { items: [{ name: 'Admin' }, { name: 'Sales Manager' }] },
    };
    catalog.teams = {
      status: 'success',
      fetchStatus: 'fetching',
      data: { items: [{ name: 'France' }] },
    };
    render(<PolicyBuilder rules={[rule()]} onChange={vi.fn()} options={OPTIONS} />);

    expect(screen.getAllByRole('checkbox', { name: 'Admin' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('checkbox', { name: 'France' }).length).toBeGreaterThan(0);
    expect(screen.queryByText('The role list has not arrived.')).toBeNull();
    expect(screen.queryByText('The role list did not load.')).toBeNull();
    expect(screen.queryByText('No roles yet.')).toBeNull();
    expect(screen.queryByText('The team list has not arrived.')).toBeNull();
  });
});
