import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useSalesToolkits } from '@/hooks/useSalesToolkits';

import SalesToolkitsPage from './SalesToolkitsPage';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string) => fallback,
  }),
}));

vi.mock('@/hooks/useSalesToolkits', () => ({
  useSalesToolkits: vi.fn(),
}));

vi.mock('./salesToolkits/ToolkitStoreSection', () => ({
  ToolkitStoreSection: () => <div>Stored collateral</div>,
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('SalesToolkitsPage academy courses', () => {
  it('does not list sample academy courses when the LMS is not connected', () => {
    vi.mocked(useSalesToolkits).mockReturnValue({
      isLoading: false,
      isError: false,
      data: {
        enabled: false,
        preview: true,
        items: [
          {
            id: 'sample-fins-1',
            title: 'Winning Financial Services Bids',
            description: 'Sample',
            sectorTags: ['Banking'],
            url: 'https://mantuacademy.360learning.com/',
          },
        ],
      },
    } as never);

    render(<SalesToolkitsPage />);

    expect(screen.getByText('Mantu Academy is not connected. Sample courses are not listed.')).toBeTruthy();
    expect(screen.queryByText('Winning Financial Services Bids')).toBeNull();
    expect(screen.queryByText('Open in Mantu Academy')).toBeNull();
  });

  it('lists a course when the academy response is live', () => {
    vi.mocked(useSalesToolkits).mockReturnValue({
      isLoading: false,
      isError: false,
      data: {
        enabled: true,
        preview: false,
        items: [
          {
            id: 'live-1',
            title: 'Recorded pursuit workshop',
            description: null,
            sectorTags: ['Banking'],
            url: 'https://example.com/course',
          },
        ],
      },
    } as never);

    render(<SalesToolkitsPage />);

    expect(screen.getByText('Recorded pursuit workshop')).toBeTruthy();
    expect(screen.getByText('Open in Mantu Academy')).toBeTruthy();
  });
});