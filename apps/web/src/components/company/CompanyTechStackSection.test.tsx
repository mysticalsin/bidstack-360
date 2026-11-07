import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const stackHook = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/useCompanyTechnicalStack', () => ({ useCompanyTechnicalStack: stackHook }));

import { CompanyTechStackSection } from './CompanyTechStackSection';

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
});
