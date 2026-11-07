import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  useAccessPolicies: vi.fn(),
  transition: vi.fn(),
  save: vi.fn(),
  simulate: vi.fn(),
  useHasPermission: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback: string, vars?: Record<string, unknown>) =>
      fallback.replace(/\{\{(\w+)\}\}/g, (_, n: string) => String(vars?.[n] ?? '')),
  }),
}));
vi.mock('@/hooks/useAccessPolicies', () => ({
  useAccessPolicies: m.useAccessPolicies,
  useAccessPolicyTransition: () => ({ mutateAsync: m.transition, isPending: false }),
  useSaveAccessPolicy: () => ({ mutateAsync: m.save, isPending: false }),
  useSimulateAccessPolicy: () => ({ mutate: m.simulate, isPending: false }),
}));
vi.mock('@/hooks/useCapabilities', () => ({ useHasPermission: m.useHasPermission }));
vi.mock('@/hooks/useRoles', () => ({ useRoles: () => ({ data: { items: [{ name: 'Admin' }] } }) }));
vi.mock('@/hooks/useUserGroups', () => ({ useUserGroups: () => ({ data: { items: [{ name: 'France' }] } }) }));
vi.mock('@/components/ui/Toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/components/ui/ConfirmDialog', () => ({ confirm: vi.fn().mockResolvedValue(true) }));

import { AccessPoliciesSection } from './AccessPoliciesSection';

const APPROVED = {
  id: 'a1',
  name: 'No DE writes',
  status: 'approved',
  version: null,
  rules: [],
  createdById: 'author',
  createdByName: 'Tony Admin',
  submittedAt: '2026-11-07T12:00:00.000Z',
  approvedById: 'reviewer',
  approvedByName: 'Rae Reviewer',
  approvedAt: '2026-11-07T12:30:00.000Z',
  decisionNote: null,
  publishedAt: null,
  rollbackOfId: null,
  createdAt: '2026-11-07T11:00:00.000Z',
};

beforeEach(() => {
  m.useHasPermission.mockReturnValue(true);
  m.useAccessPolicies.mockReturnValue({
    data: { items: [APPROVED], published: null, nextVersion: 1, enforcement: false, viewerId: 'author' },
    isLoading: false,
    isError: false,
  });
  m.transition.mockResolvedValue({ ...APPROVED, status: 'published', version: 1 });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('AccessPoliciesSection', () => {
  it('says enforcement is off and the matrix applies when nothing is published', () => {
    render(<AccessPoliciesSection />);
    expect(screen.getByText('Enforcement off')).toBeTruthy();
    expect(screen.getByText('Nothing published yet. The RBAC matrix applies as is.')).toBeTruthy();
  });

  it('announces the published version politely', async () => {
    render(<AccessPoliciesSection />);
    fireEvent.click(screen.getByRole('button', { name: 'Publish v1' }));
    await waitFor(() => expect(m.transition).toHaveBeenCalledWith({ id: 'a1', action: 'publish', note: undefined }));
    const live = await screen.findByText('Published v1.');
    expect(live.getAttribute('aria-live')).toBe('polite');
  });

  it('keeps the builder read only without access-policies:write', () => {
    m.useHasPermission.mockImplementation((k: string) => k === 'access-policies:read');
    render(<AccessPoliciesSection />);
    expect(screen.queryByRole('button', { name: 'Add rule' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Submit for approval' })).toBeNull();
  });
});
