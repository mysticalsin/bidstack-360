import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ConvertLeadDialog } from './ConvertLeadDialog';

// Demo leads stay open (new, contacted, qualified, nurture). Converting one
// must file the deal on a board column. The old labels (Discovery, Qualified,
// Proposal) named stages the board does not have, and Qualified is a lead
// status, so a qualified demo lead looked already placed.
describe('ConvertLeadDialog stage', () => {
  afterEach(() => cleanup());

  it('starts a qualified demo lead on S1 Lead and names the board columns', () => {
    const onConvert = vi.fn();
    render(
      <ConvertLeadDialog
        companyName="Example Industrial"
        isPending={false}
        onClose={vi.fn()}
        onConvert={onConvert}
      />,
    );

    const stage = screen.getByRole('combobox', { name: 'Stage' }) as HTMLSelectElement;
    const options = within(stage).getAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual([
      'S1 Lead',
      'S1 Ongoing',
      'S2 Sent',
      'S3 Technical Iteration',
      'S4 Negotiation',
      'Closed Won',
      'Closed Lost',
    ]);
    expect(options.map((option) => option.getAttribute('value'))).toEqual([
      's1_lead',
      's1_ongoing',
      's2_sent',
      's3_technical_iteration',
      's4_negotiation',
      'closed_won',
      'closed_lost',
    ]);
    expect(stage.value).toBe('s1_lead');

    fireEvent.click(screen.getByRole('button', { name: 'Convert lead' }));
    expect(onConvert).toHaveBeenCalledWith(
      expect.objectContaining({ stage: 's1_lead', opportunityName: undefined }),
    );

    fireEvent.change(stage, { target: { value: 's2_sent' } });
    fireEvent.click(screen.getByRole('button', { name: 'Convert lead' }));
    expect(onConvert).toHaveBeenLastCalledWith(expect.objectContaining({ stage: 's2_sent' }));
  });
});
