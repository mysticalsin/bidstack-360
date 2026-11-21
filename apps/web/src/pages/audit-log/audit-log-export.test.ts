import { afterEach, describe, expect, it, vi } from 'vitest';

const toastMocks = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('@/components/ui/Toast', () => ({ toast: toastMocks }));

import { exportCsv, writeClipboard } from './audit-log-export';

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

describe('exportCsv formula neutralization', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('prefixes a leading tab or CR before the audit CSV is downloaded', () => {
    let csv = '';
    const RealBlob = globalThis.Blob;
    vi.spyOn(globalThis, 'Blob').mockImplementation(function (parts, options) {
      csv = String((parts as BlobPart[] | undefined)?.[0] ?? '');
      return new RealBlob(parts as BlobPart[], options);
    });
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:audit-csv');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
      if (tag === 'a') {
        return { href: '', download: '', click: () => undefined } as HTMLAnchorElement;
      }
      return Document.prototype.createElement.call(document, tag);
    }) as typeof document.createElement);

    exportCsv([
      {
        id: '1',
        createdAt: '2026-11-21T00:00:00.000Z',
        action: '\t=HYPERLINK("https://evil.example","x")',
        category: 'other',
        targetType: null,
        targetId: null,
        userId: null,
        userName: 'Ada',
        userEmail: '\r=cmd|@evil.example',
        diff: null,
      } as never,
    ]);

    expect(csv).toContain(`"'\t=HYPERLINK(""https://evil.example"",""x"")"`);
    expect(csv).toContain(`"'\r=cmd|@evil.example"`);
    expect(csv).not.toContain('"\t=HYPERLINK');
  });
});
