import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// A permission manifest, a policy list, or a role catalog that has not arrived
// is not a denial and not an empty role set. These tests fail while the screen
// still says "limited to administrators", "did not load", or offers Add rule
// against a catalog that never arrived.

const m = vi.hoisted(() => ({
  useAccessPolicies: vi.fn(),
  useHasPermission: vi.fn(),
  useCapabilities: vi.fn(),
  useRoles: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback: string, vars?: Record<string, unknown>) =>
      fallback.replace(/\{\{(\w+)\}\}/g, (_, n: string) => String(vars?.[n] ?? '')),
  }),
}));
vi.mock('@/hooks/useAccessPolicies', () => ({
  useAccessPolicies: m.useAccessPolicies,
  useAccessPolicyTransition: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useSaveAccessPolicy: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useSimulateAccessPolicy: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('@/hooks/useCapabilities', () => ({
  useHasPermission: m.useHasPermission,
  useCapabilities: m.useCapabilities,
}));
vi.mock('@/hooks/useRoles', () => ({ useRoles: m.useRoles }));
vi.mock('@/hooks/useUserGroups', () => ({
  useUserGroups: () => ({ data: { items: [{ name: 'Demo team' }] }, isError: false }),
}));
vi.mock('@/components/ui/Toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/components/ui/ConfirmDialog', () => ({ confirm: vi.fn().mockResolvedValue(true) }));

import { AccessPoliciesSection } from './AccessPoliciesSection';

const DENIED = 'Access policies are limited to administrators.';
const CHECKING_ACCESS = 'Checking access. The permission has not arrived.';
const ACCESS_FAILED = 'Could not load access. The permission has not arrived.';
const CHECKING_POLICIES = 'Checking access policies. They have not arrived.';
const POLICIES_FAILED = 'Access policies did not load';
const CHECKING_ROLES = 'Checking roles. They have not arrived.';
const ROLES_FAILED = 'Could not load roles. They have not arrived.';

const LOADED_LIST = {
  items: [],
  published: null,
  nextVersion: 1,
  enforcement: false,
  viewerId: 'user-demo',
};

function caps(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      permissions: ['access-policies:read', 'access-policies:write'],
      isAdmin: false,
    },
    isError: false,
    isPending: false,
    isLoading: false,
    ...overrides,
  };
}

function list(overrides: Record<string, unknown> = {}) {
  return {
    data: LOADED_LIST,
    isError: false,
    isLoading: false,
    isPending: false,
    ...overrides,
  };
}

function roles(overrides: Record<string, unknown> = {}) {
  return {
    data: { items: [{ id: 'role-demo-reviewer', name: 'Demo reviewer' }] },
    isError: false,
    isLoading: false,
    isPending: false,
    ...overrides,
  };
}

beforeEach(() => {
  m.useHasPermission.mockReturnValue(true);
  m.useCapabilities.mockReturnValue(caps());
  m.useAccessPolicies.mockReturnValue(list());
  m.useRoles.mockReturnValue(roles());
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Access policies read honesty', () => {
  it('does not call a paused permission read a denial, because the manifest has not arrived', () => {
    m.useHasPermission.mockReturnValue(false);
    m.useCapabilities.mockReturnValue(
      caps({ data: undefined, isPending: true, isLoading: false, fetchStatus: 'paused' }),
    );
    render(<AccessPoliciesSection />);
    expect(screen.queryByText(DENIED)).toBeNull();
    expect(screen.getByText(CHECKING_ACCESS)).toBeTruthy();
  });

  it('does not call an in-flight permission read a denial, because a missing manifest is not a no', () => {
    m.useHasPermission.mockReturnValue(false);
    m.useCapabilities.mockReturnValue(
      caps({ data: undefined, isPending: true, isLoading: true, fetchStatus: 'fetching' }),
    );
    render(<AccessPoliciesSection />);
    expect(screen.queryByText(DENIED)).toBeNull();
    expect(screen.getByText(CHECKING_ACCESS)).toBeTruthy();
  });

  it('does not call a failed permission read a denial, because the failure is the status', () => {
    m.useHasPermission.mockReturnValue(false);
    m.useCapabilities.mockReturnValue(caps({ data: undefined, isError: true, isPending: false }));
    render(<AccessPoliciesSection />);
    expect(screen.queryByText(DENIED)).toBeNull();
    expect(screen.getByText(ACCESS_FAILED)).toBeTruthy();
  });

  it('still says access is limited when the manifest arrived without the permission', () => {
    m.useHasPermission.mockReturnValue(false);
    m.useCapabilities.mockReturnValue(
      caps({ data: { permissions: [], isAdmin: false }, isError: false, isPending: false }),
    );
    render(<AccessPoliciesSection />);
    expect(screen.getByText(DENIED)).toBeTruthy();
    expect(screen.queryByText(CHECKING_ACCESS)).toBeNull();
  });

  it('does not call a paused policy list a failed load', () => {
    m.useAccessPolicies.mockReturnValue(
      list({ data: undefined, isError: false, isLoading: false, isPending: true, fetchStatus: 'paused' }),
    );
    render(<AccessPoliciesSection />);
    expect(screen.queryByText(POLICIES_FAILED)).toBeNull();
    expect(screen.getByText(CHECKING_POLICIES)).toBeTruthy();
  });

  it('does not call an in-flight policy list a failed load or leave only a skeleton', () => {
    m.useAccessPolicies.mockReturnValue(
      list({ data: undefined, isError: false, isLoading: true, isPending: true, fetchStatus: 'fetching' }),
    );
    render(<AccessPoliciesSection />);
    expect(screen.queryByText(POLICIES_FAILED)).toBeNull();
    expect(screen.getByText(CHECKING_POLICIES)).toBeTruthy();
    expect(screen.queryByRole('status', { busy: true })).toBeNull();
  });

  it('still says the policy list failed when the read failed with no payload', () => {
    m.useAccessPolicies.mockReturnValue(
      list({ data: undefined, isError: true, isLoading: false, isPending: false }),
    );
    render(<AccessPoliciesSection />);
    expect(screen.getByText(POLICIES_FAILED)).toBeTruthy();
    expect(screen.queryByText(CHECKING_POLICIES)).toBeNull();
  });

  it('keeps a loaded policy list when a later read fails', () => {
    m.useAccessPolicies.mockReturnValue(list({ isError: true, isLoading: false }));
    render(<AccessPoliciesSection />);
    expect(screen.getByText('Enforcement off')).toBeTruthy();
    expect(screen.queryByText(POLICIES_FAILED)).toBeNull();
  });

  it('does not treat an unread role catalog as a finished empty role set', () => {
    m.useRoles.mockReturnValue(roles({ data: undefined, isError: false, isPending: true, isLoading: true }));
    render(<AccessPoliciesSection />);
    expect(screen.getByText('Enforcement off')).toBeTruthy();
    expect(screen.getByText(CHECKING_ROLES)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add rule' })).toBeNull();
  });

  it('does not offer rule edits when the role catalog failed', () => {
    m.useRoles.mockReturnValue(roles({ data: undefined, isError: true, isPending: false }));
    render(<AccessPoliciesSection />);
    expect(screen.getByText(ROLES_FAILED)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add rule' })).toBeNull();
    expect(screen.queryByText(CHECKING_ROLES)).toBeNull();
  });

  it('still shows a loaded role once the catalog arrives', () => {
    render(<AccessPoliciesSection />);
    fireEvent.click(screen.getByRole('button', { name: 'Add rule' }));
    expect(screen.getAllByRole('checkbox', { name: 'Demo reviewer' }).length).toBeGreaterThan(0);
  });

  it('keeps a loaded role when a later catalog read fails', () => {
    m.useRoles.mockReturnValue(roles({ isError: true }));
    render(<AccessPoliciesSection />);
    fireEvent.click(screen.getByRole('button', { name: 'Add rule' }));
    expect(screen.getAllByRole('checkbox', { name: 'Demo reviewer' }).length).toBeGreaterThan(0);
    expect(screen.queryByText(ROLES_FAILED)).toBeNull();
  });
});
