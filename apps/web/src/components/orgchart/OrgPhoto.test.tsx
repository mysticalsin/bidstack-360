import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { OrgPhoto } from './OrgPhoto';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('OrgPhoto', () => {
  it('keeps a shared API photo alive when one of two copies unmounts', async () => {
    const revoke = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Blob(['x'], { type: 'image/webp' }), { status: 200 })));
    Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:photo-1'), revokeObjectURL: revoke });
    const qc = new QueryClient();
    const two = (both: boolean) => (
      <QueryClientProvider client={qc}>
        <div data-testid="a"><OrgPhoto url="/api/v1/org-chart/nodes/n1/photo" name="Ana Silva" /></div>
        {both ? <div data-testid="b"><OrgPhoto url="/api/v1/org-chart/nodes/n1/photo" name="Ana Silva" /></div> : null}
      </QueryClientProvider>
    );
    const { rerender, container } = render(two(true));
    await waitFor(() => expect(container.querySelectorAll('img')).toHaveLength(2));
    rerender(two(false));
    expect(revoke).not.toHaveBeenCalled();
    expect(screen.getByTestId('a').querySelector('img')?.getAttribute('src')).toBe('blob:photo-1');
  });

  it('shows initials without a usable photo and never loads http photos', () => {
    render(<QueryClientProvider client={new QueryClient()}><OrgPhoto url="http://example.com/a.png" name="Ana Silva" /></QueryClientProvider>);
    expect(screen.getByText('AS')).toBeTruthy();
    expect(document.querySelector('img')).toBeNull();
  });
});
