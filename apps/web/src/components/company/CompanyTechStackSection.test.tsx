import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const stackHook = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/useCompanyTechnicalStack', () => ({ useCompanyTechnicalStack: stackHook }));

import { CompanyTechStackSection } from './CompanyTechStackSection';

const CHECKED = '2026-11-07T10:00:00.000Z';

describe('CompanyTechStackSection', () => {
  afterEach(() => {
    cleanup();
    stackHook.mockReset();
  });

  it('looks the stack up by company id, which resolves accounts without an enrichment row', () => {
    stackHook.mockReturnValue({ data: undefined, isLoading: false });

    render(<CompanyTechStackSection companyId="c0000000-0000-4000-8000-0000000000aa" />);

    expect(stackHook).toHaveBeenCalledWith('c0000000-0000-4000-8000-0000000000aa');
  });

  it('shows a plain empty state with no helper paragraphs', () => {
    stackHook.mockReturnValue({ data: { effectiveStack: [] }, isLoading: false });

    render(<CompanyTechStackSection companyId="c0000000-0000-4000-8000-0000000000aa" />);

    expect(screen.getByText('No technology detected yet')).toBeTruthy();
    expect(screen.queryByText(/Detected and curated tools/)).toBeNull();
    expect(screen.queryByText(/Tools appear here/)).toBeNull();
  });

  it('groups the wall by category with a source chip, confidence and the coverage line', () => {
    stackHook.mockReturnValue({
      isLoading: false,
      data: {
        effectiveStack: [
          {
            label: 'Collaboration',
            items: [{ name: 'Microsoft 365', source: 'open_data:dns', confidence: 0.95, evidence: { url: null, record: 'MX x.mail.protection.outlook.com', observedAt: CHECKED } }],
          },
          { label: 'Data', items: [{ name: 'Snowflake', source: 'open_data:jobs', confidence: 0.71 }] },
        ],
        coverage: {
          checkedAt: CHECKED,
          openItems: 2,
          apolloFallback: 'not_configured',
          apolloThreshold: 5,
          sample: false,
          lanes: [
            { lane: 'dns', status: 'found', count: 1, detail: null, checkedAt: CHECKED },
            { lane: 'jobs', status: 'found', count: 1, detail: null, checkedAt: CHECKED },
            { lane: 'github', status: 'empty', count: 0, detail: null, checkedAt: CHECKED },
          ],
        },
      },
    });

    render(<CompanyTechStackSection companyId="c0000000-0000-4000-8000-0000000000aa" />);

    expect(screen.getByRole('heading', { name: 'Collaboration' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Data' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Microsoft 365 evidence, DNS, 95% confidence/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Snowflake evidence, Jobs, 71% confidence/ })).toBeTruthy();
    expect(screen.getByTestId('tech-coverage-line').textContent).toContain('Nothing found in GitHub.');
  });

  it('shows a plain error with a retry', () => {
    const refetch = vi.fn();
    stackHook.mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch });

    render(<CompanyTechStackSection companyId="c0000000-0000-4000-8000-0000000000aa" />);

    expect(screen.getByText('Could not load technology stack')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalled();
  });
});
