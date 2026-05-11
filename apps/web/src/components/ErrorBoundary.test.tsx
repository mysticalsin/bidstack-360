import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { ErrorBoundary } from './ErrorBoundary';

function ThrowError(): never {
  throw new Error('Test error');
}

afterEach(() => {
  cleanup();
});

describe('ErrorBoundary', () => {
  it('renders children when there is no error', () => {
    render(
      <ErrorBoundary>
        <div data-testid="child">Safe content</div>
      </ErrorBoundary>,
    );

    expect(screen.getByTestId('child')).toBeDefined();
  });

  it('renders fallback UI when a child throws', () => {
    // Suppress console.error for this test to keep output clean
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <ErrorBoundary>
        <ThrowError />
      </ErrorBoundary>,
    );

    expect(screen.getByRole('heading', { name: /something went wrong/i })).toBeDefined();
    expect(screen.getByText(/error id/i)).toBeDefined();
    expect(screen.getByRole('button', { name: /reload page/i })).toBeDefined();

    consoleError.mockRestore();
  });

  it('calls window.location.reload when reload button is clicked', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('location', { reload: vi.fn() });

    render(
      <ErrorBoundary>
        <ThrowError />
      </ErrorBoundary>,
    );

    const reloadBtn = screen.getByRole('button', { name: /reload page/i });
    reloadBtn.click();

    expect(window.location.reload).toHaveBeenCalled();

    vi.unstubAllGlobals();
    consoleError.mockRestore();
  });
});
