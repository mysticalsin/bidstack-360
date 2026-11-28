// The preview banner is the only seller-facing label for fixture academy courses.
// preview:true still lists those courses and still names LMS_360L_ENABLED.
// The banner says Reference / reference records. It does not say Sample, demo,
// illustrative, or live. A non-preview response hides the banner.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import SalesToolkitsPage from './SalesToolkitsPage';
import { useSalesToolkits, type SalesToolkitCourse } from '@/hooks/useSalesToolkits';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string, opts?: Record<string, unknown>) => {
      if (typeof fallback !== 'string') return key;
      if (!opts) return fallback;
      return Object.entries(opts).reduce(
        (line, [name, value]) => line.replaceAll(`{{${name}}}`, String(value)),
        fallback,
      );
    },
    i18n: { language: 'en' },
  }),
}));

vi.mock('@/hooks/useSalesToolkits', () => ({ useSalesToolkits: vi.fn() }));

vi.mock('./salesToolkits/ToolkitStoreSection', () => ({
  ToolkitStoreSection: () => null,
}));

const COURSE: SalesToolkitCourse = {
  id: 'course-1',
  title: 'Sector discovery',
  description: 'How a seller opens a first meeting.',
  sectorTags: ['Energy'],
  url: 'https://academy.example/courses/sector-discovery',
};

const DEMO_COPY = /\bsample\b|\bdemo\b|\billustrative\b|\blive\b/i;

function mockToolkits(preview: boolean) {
  vi.mocked(useSalesToolkits).mockReturnValue({
    data: { enabled: !preview, preview, items: [COURSE] },
    isLoading: false,
    isError: false,
    error: null,
  } as ReturnType<typeof useSalesToolkits>);
}

function banner(): HTMLElement {
  const code = screen.getAllByText('LMS_360L_ENABLED').find((el) => el.tagName === 'CODE');
  const node = code?.closest('[role="status"]');
  if (!(node instanceof HTMLElement)) throw new Error('preview banner missing');
  return node;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('SalesToolkitsPage preview banner', () => {
  it('labels fixture courses as reference records and keeps the credential path', () => {
    mockToolkits(true);
    render(<SalesToolkitsPage />);

    const node = banner();
    // Fixture rows stay on screen. The flag is still preview; the words are not a demo.
    expect(screen.getByRole('heading', { level: 2, name: 'Sector discovery' })).toBeTruthy();
    expect(node.textContent).toContain('Reference.');
    expect(node.textContent).toContain('reference records');
    expect(node.textContent).toContain('credentials');
    expect(node.textContent).toContain('Mantu Academy');
    expect(node.textContent).not.toMatch(DEMO_COPY);
    expect(screen.queryByText('Sample data.')).toBeNull();
    expect(screen.queryByText(/illustrative/i)).toBeNull();
  });

  it('hides the banner when the academy response is not a preview', () => {
    mockToolkits(false);
    render(<SalesToolkitsPage />);

    expect(screen.getByRole('heading', { level: 2, name: 'Sector discovery' })).toBeTruthy();
    expect(screen.queryByText('LMS_360L_ENABLED')).toBeNull();
    expect(screen.queryByText('Reference.')).toBeNull();
    expect(screen.queryByText('Sample data.')).toBeNull();
  });
});
