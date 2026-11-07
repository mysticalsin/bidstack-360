import { afterEach, describe, expect, it, vi } from 'vitest';

const toastMocks = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('@/components/ui/Toast', () => ({ toast: toastMocks }));

import { writeClipboard } from './audit-log-export';

function stubClipboard(writeText: (value: string) => Promise<void>) {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  });
}

describe('writeClipboard', () => {
  afterEach(() => {
    toastMocks.success.mockReset();
    toastMocks.error.mockReset();
  });

  it('confirms a successful copy', async () => {
    stubClipboard(() => Promise.resolve());
    await writeClipboard('https://polo.test/audit-log?range=7d', 'Link copied');
    expect(toastMocks.success).toHaveBeenCalledWith('Link copied');
  });

  it('reports a denied clipboard instead of rejecting unhandled', async () => {
    stubClipboard(() => Promise.reject(new Error('Write permission denied.')));
    await expect(writeClipboard('abc', 'Copied')).resolves.toBeUndefined();
    expect(toastMocks.error).toHaveBeenCalledTimes(1);
    expect(toastMocks.success).not.toHaveBeenCalled();
  });

  it('does nothing for an empty value', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    stubClipboard(writeText);
    await writeClipboard('', 'Copied');
    expect(writeText).not.toHaveBeenCalled();
  });
});
