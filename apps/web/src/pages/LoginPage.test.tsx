// The public demo used to replace /login with a "Live demo · no signup"
// interstitial. Login must stay the real sign-in screen, and an existing
// session must land on the dashboard — the app's post-auth home — rather
// than that screen. These tests fail if that interstitial returns or if a
// signed-in visit to /login stops resolving to /dashboard.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

import { AuthProvider } from '@/lib/auth';

import { LoginPage } from './LoginPage';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}));

function LocationProbe() {
  const loc = useLocation();
  return <div data-testid="location">{loc.pathname}</div>;
}

function renderAtLogin() {
  return render(
    <AuthProvider publishableKey={undefined}>
      <MemoryRouter initialEntries={['/login']}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/dashboard" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  );
}

describe('LoginPage — stub sign-in lands in the app', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
  });

  it('shows the real sign-in screen and not the live-demo interstitial', () => {
    localStorage.setItem('bidstack:stub-signed-out', 'true');
    renderAtLogin();

    expect(screen.queryByText('Live demo · no signup')).toBeNull();
    expect(screen.queryByText('Enter the demo')).toBeNull();
    expect(screen.queryByRole('textbox', { name: /work email/i })).toBeNull();
    expect(screen.getByRole('button', { name: 'Sign in with Microsoft' })).toBeTruthy();
    expect(screen.getByRole('main', { name: 'Sign in' })).toBeTruthy();
  });

  it('sends a successful sign-in to the dashboard', () => {
    localStorage.setItem('bidstack:stub-signed-out', 'true');
    renderAtLogin();

    fireEvent.click(screen.getByRole('button', { name: 'Sign in with Microsoft' }));

    expect(screen.getByTestId('location').textContent).toBe('/dashboard');
    expect(screen.queryByText('Live demo · no signup')).toBeNull();
  });

  it('sends an existing session straight to the dashboard', () => {
    localStorage.setItem('bidstack:session', 'stub');
    renderAtLogin();

    expect(screen.getByTestId('location').textContent).toBe('/dashboard');
    expect(screen.queryByText('Live demo · no signup')).toBeNull();
  });
});

describe('LoginPage — demo auth mode has no no-signup screen', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubEnv('VITE_AUTH_MODE', 'demo');
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
  });

  it('shows the real sign-in screen instead of the live-demo interstitial', () => {
    renderAtLogin();

    expect(screen.queryByText('Live demo · no signup')).toBeNull();
    expect(screen.queryByText('Enter the demo')).toBeNull();
    expect(screen.queryByRole('textbox', { name: /work email/i })).toBeNull();
    expect(screen.getByRole('button', { name: 'Sign in with Microsoft' })).toBeTruthy();
  });

  it('sends a successful sign-in to the dashboard and keeps that session', () => {
    const first = renderAtLogin();

    fireEvent.click(screen.getByRole('button', { name: 'Sign in with Microsoft' }));
    expect(screen.getByTestId('location').textContent).toBe('/dashboard');

    // A refresh remounts auth from storage. The session must still resolve to
    // the dashboard, not back to the removed demo screen.
    first.unmount();
    renderAtLogin();
    expect(screen.getByTestId('location').textContent).toBe('/dashboard');
    expect(screen.queryByText('Live demo · no signup')).toBeNull();
  });
});
