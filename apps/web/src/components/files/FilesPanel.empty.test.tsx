import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string) => fallback,
  }),
}));

vi.mock('@/hooks/useFiles', () => ({
  useFiles: () => ({
    data: { items: [], itemsContinue: false },
    isLoading: false,
    isError: false,
    error: null,
  }),
  useUploadFile: () => ({ isPending: false, mutate: vi.fn() }),
  useDeleteFile: () => ({ isPending: false, mutate: vi.fn() }),
}));

import { FilesPanel } from './FilesPanel';

describe('FilesPanel empty account', () => {
  afterEach(() => {
    cleanup();
  });

  it('says there are no files when the loaded page is empty', () => {
    // WHY: demo seed attaches no account files, so this card is what the
    // cockpit shows. The header used to say "0 attachment(s) - access follows
    // account groups", which reads as if files were hidden. The page loaded
    // and there is nothing to download.
    render(<FilesPanel accountId="acme" />);

    expect(screen.getByText('No files on this account')).toBeTruthy();
    expect(screen.queryByText(/0 attachment/)).toBeNull();
    expect(screen.queryByText(/access follows account groups/)).toBeNull();
    expect(screen.getByText(/No files yet/)).toBeTruthy();
  });
});
