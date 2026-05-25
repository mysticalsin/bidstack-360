import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Input } from './Input';
import { Select } from './Select';

describe('form primitives accessibility', () => {
  it('generates stable labeling and error references for inputs without an explicit id', () => {
    render(<Input label="Workspace name" error="Required" readOnly defaultValue="BidStack" />);

    const input = screen.getByRole('textbox', { name: 'Workspace name' });
    const error = screen.getByText('Required');

    expect(input.getAttribute('readonly')).toBe('');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-errormessage')).toBe(error.id);
    expect(input.getAttribute('aria-describedby')).toBe(error.id);
  });

  it('generates stable labeling and helper references for selects without an explicit id', () => {
    render(
      <Select
        label="Default currency"
        helper="Used in pipeline summaries."
        defaultValue="usd"
        options={[{ value: 'usd', label: 'USD' }]}
      />,
    );

    const select = screen.getByRole('combobox', { name: 'Default currency' });
    const helper = screen.getByText('Used in pipeline summaries.');

    expect(select.getAttribute('aria-describedby')).toBe(helper.id);
  });
});
