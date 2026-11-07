import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const stackHook = vi.hoisted(() => vi.fn());
const saveStack = vi.hoisted(() => vi.fn());
const canWrite = vi.hoisted(() => ({ value: false }));
vi.mock('@/hooks/useCompanyTechnicalStack', () => ({
  useCompanyTechnicalStack: stackHook,
  useSaveCompanyTechnicalStack: () => ({ mutateAsync: saveStack, isPending: false }),
}));
vi.mock('@/hooks/useCapabilities', () => ({ useHasPermission: () => canWrite.value }));

import { CompanyTechStackSection } from './CompanyTechStackSection';

const CHECKED = '2026-11-07T10:00:00.000Z';

describe('CompanyTechStackSection', () => {
  afterEach(() => {
    cleanup();
    stackHook.mockReset();
    saveStack.mockReset();
    canWrite.value = false;
  });

  it('shows each named stack on its own when a company runs more than one', () => {
    stackHook.mockReturnValue({
      isLoading: false,
      data: {
        effectiveStack: [
          { label: 'Cloud', items: [{ name: 'Azure', source: 'manual', confidence: 1 }] },
          { stack: 'Oncology R&D', label: 'Cloud', items: [{ name: 'AWS', source: 'manual', confidence: 1 }] },
        ],
      },
    });

    render(<CompanyTechStackSection companyId="c0000000-0000-4000-8000-0000000000aa" />);

    expect(screen.getByRole('heading', { name: 'Main stack' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Oncology R&D' })).toBeTruthy();
    expect(screen.getAllByRole('heading', { name: 'Cloud' })).toHaveLength(2);
  });

  it('hides editing from users who cannot write companies', () => {
    stackHook.mockReturnValue({ isLoading: false, data: { effectiveStack: [] } });

    render(<CompanyTechStackSection companyId="c0000000-0000-4000-8000-0000000000aa" />);

    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
  });

  it('lets a writer add, remove and split technologies into another stack, then saves', async () => {
    canWrite.value = true;
    saveStack.mockResolvedValue({});
    stackHook.mockReturnValue({
      isLoading: false,
      data: {
        effectiveStack: [
          {
            label: 'Cloud',
            items: [
              { name: 'Azure', source: 'open_data:dns', confidence: 0.9 },
              { name: 'Heroku', source: 'open_data:web', confidence: 0.5 },
            ],
          },
        ],
      },
    });

    render(<CompanyTechStackSection companyId="c0000000-0000-4000-8000-0000000000aa" />);

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove Heroku' }));
    fireEvent.change(screen.getByLabelText('Add technology to category 1'), { target: { value: 'AWS' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Add' })[0]!);

    fireEvent.click(screen.getByRole('button', { name: 'Add another stack' }));
    fireEvent.change(screen.getByLabelText('Stack for category 2'), { target: { value: 'Oncology R&D' } });
    fireEvent.change(screen.getByLabelText('Category 2 name'), { target: { value: 'Data' } });
    fireEvent.change(screen.getByLabelText('Add technology to category 2'), { target: { value: 'Snowflake' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Add' })[1]!);

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(saveStack).toHaveBeenCalledTimes(1));
    expect(saveStack).toHaveBeenCalledWith([
      {
        label: 'Cloud',
        items: [
          { name: 'Azure', source: 'open_data:dns', confidence: 0.9 },
          { name: 'AWS', source: 'manual', confidence: 1 },
        ],
      },
      {
        stack: 'Oncology R&D',
        label: 'Data',
        items: [{ name: 'Snowflake', source: 'manual', confidence: 1 }],
      },
    ]);
    await waitFor(() => expect(screen.queryByTestId('tech-stack-editor')).toBeNull());
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
