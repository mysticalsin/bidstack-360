import { readFileSync } from 'node:fs';
import path from 'node:path';

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { configuredWorkspaceId } from './workspace-id';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string) => fallback,
  }),
}));

vi.mock('@/lib/auth', () => ({
  useAuth: () => ({ isSignedIn: true, isLoaded: true }),
  useIsAdmin: () => false,
  useUser: () => ({
    user: {
      fullName: 'Ada Admin',
      firstName: 'Ada',
      primaryEmailAddress: { emailAddress: 'ada.admin@example.test' },
    },
  }),
}));

vi.mock('@/hooks/useDataResidency', () => ({
  useDataResidency: () => ({ isLoading: true, isError: false, data: undefined, error: null }),
  useUpdateDataResidency: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { SecuritySection } from './SecuritySection';
import { WorkspaceSection } from './WorkspaceSection.original';

const WORKSPACE_SRC = path.resolve(process.cwd(), 'src/components/settings/WorkspaceSection.original.tsx');
const SECURITY_SRC = path.resolve(process.cwd(), 'src/components/settings/SecuritySection.tsx');

describe('configured workspace id', () => {
  it('keeps an unset id empty and keeps a configured id', () => {
    // WHY: the settings cards exist so an admin can confirm the org before
    // minting a key. An unset build-time id is not a tenant. Filling it with
    // another org's name would make that check lie. A value the build did set
    // is shown as written, after trimming.
    expect(configuredWorkspaceId(undefined)).toBeNull();
    expect(configuredWorkspaceId(null)).toBeNull();
    expect(configuredWorkspaceId('')).toBeNull();
    expect(configuredWorkspaceId('   ')).toBeNull();
    expect(configuredWorkspaceId('org_demo_1')).toBe('org_demo_1');
    expect(configuredWorkspaceId('  org_demo_1  ')).toBe('org_demo_1');
  });
});

describe('settings workspace id', () => {
  afterEach(() => {
    cleanup();
  });

  it('does not invent a workspace id when the build left it unset', () => {
    // WHY: VITE_BIDSTACK_WORKSPACE_ID is unset in this repo. Workspace and
    // Security both fell back to a hardcoded tenant name, so every signed-in
    // admin was told they were in that org. The row stays, and it says the
    // id is not configured.
    const workspaceSrc = readFileSync(WORKSPACE_SRC, 'utf8');
    const securitySrc = readFileSync(SECURITY_SRC, 'utf8');

    render(<WorkspaceSection />);
    expect(screen.queryByText('mantu-presales')).toBeNull();
    expect(screen.getByText('Not configured')).toBeTruthy();
    cleanup();

    render(<SecuritySection />);
    expect(screen.queryByText('mantu-presales')).toBeNull();
    expect(screen.getByText('Not configured')).toBeTruthy();

    expect(workspaceSrc).not.toContain('mantu-presales');
    expect(securitySrc).not.toContain('mantu-presales');
    expect(workspaceSrc).toContain('configuredWorkspaceId');
    expect(securitySrc).toContain('configuredWorkspaceId');
  });
});
