import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SalesToolkitsResponse } from '@/hooks/useSalesToolkits';

import SalesToolkitsPage from './SalesToolkitsPage';

interface HookResult {
  data: SalesToolkitsResponse | undefined;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
}

const hookMocks = vi.hoisted(() => ({
  result: {
    data: undefined,
    isLoading: false,
    isError: false,
    error: null,
  } as HookResult,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback: string, values?: Record<string, unknown>) => {
      if (!values || typeof fallback !== 'string') return fallback ?? key;
      return fallback.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(values[name] ?? ''));
    },
  }),
}));

vi.mock('@/hooks/useSalesToolkits', () => ({
  useSalesToolkits: () => hookMocks.result,
}));

vi.mock('./salesToolkits/ToolkitStoreSection', () => ({
  ToolkitStoreSection: () => <div>Stored toolkits</div>,
}));

const sampleCourse: SalesToolkitsResponse = {
  enabled: false,
  preview: true,
  items: [
    {
      id: 'sample-fins-1',
      title: 'Winning Financial Services Bids',
      description: 'A sample playbook for banking pursuits.',
      sectorTags: ['Financial Services'],
      url: 'https://mantuacademy.360learning.com/',
    },
  ],
};

afterEach(() => {
  cleanup();
  hookMocks.result = { data: undefined, isLoading: false, isError: false, error: null };
});

describe('Sales Toolkits course list', () => {
  it('does not call a sample course list a live Mantu Academy catalog', () => {
    // WHY: demo leaves the LMS unset, so the route returns preview courses.
    // The heading still said those rows were pulled live from Mantu Academy
    // and offered to open them there. A sample list is not that academy.
    hookMocks.result = { data: sampleCourse, isLoading: false, isError: false, error: null };

    render(<SalesToolkitsPage />);

    expect(screen.getByRole('heading', { level: 2, name: 'Sample courses' })).toBeTruthy();
    expect(screen.getByText('Sample data. These courses are not a connected academy catalog.')).toBeTruthy();
    expect(screen.queryByText(/Mantu/i)).toBeNull();
    expect(screen.queryByRole('link', { name: /Mantu/i })).toBeNull();
  });

  it('does not say a connected academy publishes an empty sample list', () => {
    // WHY: a sector with no sample course is still sample data. The empty
    // line must not say Mantu Academy is about to publish it.
    hookMocks.result = {
      data: { enabled: false, preview: true, items: [] },
      isLoading: false,
      isError: false,
      error: null,
    };

    render(<SalesToolkitsPage />);

    expect(screen.getByText('No sample courses are in this list.')).toBeTruthy();
    expect(screen.queryByText(/Mantu/i)).toBeNull();
  });

  it('keeps a connected academy catalog labeled as that academy', () => {
    // WHY: a real LMS response is the academy catalog. This list must still
    // say so, and the course link stays.
    hookMocks.result = {
      data: {
        enabled: true,
        preview: false,
        items: [
          {
            id: 'course-1',
            title: 'Connected academy course',
            description: null,
            sectorTags: ['Banking'],
            url: 'https://academy.example.test/course-1',
          },
        ],
      },
      isLoading: false,
      isError: false,
      error: null,
    };

    render(<SalesToolkitsPage />);

    expect(screen.getByRole('heading', { level: 2, name: 'Mantu Academy courses' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open in Mantu Academy' })).toBeTruthy();
  });

  it('does not call the course list live while it is still loading', () => {
    // WHY: until the response arrives, the page does not know whether the
    // rows are sample data. Loading must not borrow the live academy label.
    hookMocks.result = { data: undefined, isLoading: true, isError: false, error: null };

    render(<SalesToolkitsPage />);

    expect(screen.getByRole('heading', { level: 2, name: 'Courses' })).toBeTruthy();
    expect(screen.getByText('Checking the course list.')).toBeTruthy();
    expect(screen.queryByText(/Mantu/i)).toBeNull();
  });
});
