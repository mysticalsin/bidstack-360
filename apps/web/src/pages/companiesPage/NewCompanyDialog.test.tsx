import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { NewCompanyDialog } from './NewCompanyDialog';

afterEach(() => cleanup());

describe('NewCompanyDialog', () => {
  it('sends one create when the form is submitted twice before the pending flag flips', () => {
    // WHY: the Create button only disables after React re-renders with
    // isPending. Two submits in the same turn both reached the API and
    // created two companies.
    const onCreate = vi.fn();
    render(<NewCompanyDialog onClose={vi.fn()} onCreate={onCreate} isPending={false} />);
    fireEvent.change(screen.getByLabelText('Company name'), { target: { value: 'Twice Labs' } });
    const form = document.querySelector('form');
    if (!form) throw new Error('form missing');
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(onCreate).toHaveBeenCalledWith({
      name: 'Twice Labs',
      domain: null,
      industry: null,
      countryCode: null,
    });
  });
});
