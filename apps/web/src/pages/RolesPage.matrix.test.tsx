import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { MATRIX_RESOURCES } from '@bidstack/shared';

vi.mock('@/lib/auth', () => ({ useIsAdmin: () => false }));
vi.mock('@/components/settings/RolesSection', () => ({ RolesSection: () => null }));
vi.mock('@/hooks/useRoles', () => ({
  useRoles: () => ({
    data: undefined,
    isError: false,
    refetch: () => Promise.resolve(),
  }),
  usePermissions: () => ({
    data: undefined,
    isError: false,
    refetch: () => Promise.resolve(),
  }),
}));

import { RolesPage } from './RolesPage';

describe('RolesPage permission matrix', () => {
  it('lists the migrations resource as a row', () => {
    expect(MATRIX_RESOURCES).toContain('migrations');
    render(<RolesPage />);
    expect(screen.getByText('migrations', { selector: 'code' })).toBeTruthy();
  });
});
