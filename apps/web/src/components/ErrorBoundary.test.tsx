import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { resetCrashGuardForTests } from '@/lib/crash-guard';

const apiMock = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ ok: true, duplicate: false, id: '1' }),
);
const reload = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api', () => ({
  api: apiMock,
  ApiError: class ApiError extends Error {
    status = 0;
    body = null;
  },
}));

import { ErrorBoundary } from './ErrorBoundary';

function ThrowError(): never {
  throw new Error('Test error');
}

beforeEach(() => {
  apiMock.mockClear();
  reload.mockClear();
  sessionStorage.clear();
  resetCrashGuardForTests();
  vi.stubGlobal('location', {
    pathname: '/dashboard',
    search: '',
    reload,
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ErrorBoundary', () => {
  it('renders children when there is no error', () => {
    render(
      <ErrorBoundary>
        <div data-testid="child">Safe content</div>
      </ErrorBoundary>,
    );

    expect(screen.getByTestId('child')).toBeDefined();
    expect(apiMock).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });

  it('renders a dashboard way out when a child throws', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <ErrorBoundary>
        <ThrowError />
      </ErrorBoundary>,
    );

    expect(screen.getByRole('heading', { name: /something went wrong/i })).toBeDefined();
    const dashboard = screen.getByRole('link', { name: /back to dashboard/i });
    expect(dashboard.getAttribute('href')).toBe('/dashboard');
    expect(screen.getByRole('button', { name: /reload page/i })).toBeDefined();

    consoleError.mockRestore();
  });

  it('sends one crash log and reloads once, then stays on the fallback', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <ErrorBoundary>
        <ThrowError />
      </ErrorBoundary>,
    );
    cleanup();
    render(
      <ErrorBoundary>
        <ThrowError />
      </ErrorBoundary>,
    );

    // WHY: the same crash must not notify admins twice or restart the app
    // twice. The second time the fallback stays so the user can leave.
    expect(apiMock).toHaveBeenCalledTimes(1);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(apiMock.mock.calls[0]?.[0]).toBe('/api/product-reports');
    const body = (
      apiMock.mock.calls[0]?.[1] as { body: { kind: string; page: string; signature: string } }
    ).body;
    expect(body.kind).toBe('crash');
    expect(body.page).toBe('/dashboard');
    expect(body.signature).toMatch(/^[a-f0-9]{8}$/);
    expect(screen.getByRole('link', { name: /back to dashboard/i })).toBeTruthy();

    consoleError.mockRestore();
  });

  it('still reloads when the reload button is clicked', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <ErrorBoundary>
        <ThrowError />
      </ErrorBoundary>,
    );

    expect(reload).toHaveBeenCalledTimes(1);
    screen.getByRole('button', { name: /reload page/i }).click();
    expect(reload).toHaveBeenCalledTimes(2);

    consoleError.mockRestore();
  });
});
