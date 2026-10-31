import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const caps = vi.hoisted(() => ({ legacyRole: 'admin', permissions: [] as string[] }));
vi.mock('./api', async (orig) => ({
  ...(await orig<typeof import('./api')>()),
  api: vi.fn(async () => ({ userId: 'u', orgId: 'o', roles: [], isAdmin: false, ...caps })),
}));

import { RequireAdmin } from '@/routes/AuthGuards';
import { AuthProvider, useIsAdmin } from './auth';

function Probe() {
  return <p>admin:{String(useIsAdmin())}</p>;
}

function mount() {
  render(
    <AuthProvider>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={['/admin']}>
          <Routes>
            <Route path="/admin" element={<RequireAdmin><Probe /></RequireAdmin>} />
            <Route path="/dashboard" element={<p>dashboard</p>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </AuthProvider>,
  );
}

describe('useIsAdmin follows RBAC settings:write, not the legacy role', () => {
  beforeEach(() => localStorage.clear());

  it('legacy admin without settings:write is not an org admin', async () => {
    caps.permissions = ['proposals:read'];
    mount();
    expect(await screen.findByText('dashboard')).toBeTruthy();
  });

  it('settings:write grants admin, and the guard waits for the manifest', async () => {
    caps.legacyRole = 'member';
    caps.permissions = ['settings:write'];
    mount();
    await waitFor(() => expect(screen.getByText('admin:true')).toBeTruthy());
  });
});
