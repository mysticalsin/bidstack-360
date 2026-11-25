// The Proposals rows on workspace search print the stored status under the
// title. Demo "Siemens ERP Technical Proposal" is review. The proposals list
// already says In review. The machine key is not that label.
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { searchProposalStatusLabel } from './search-proposal-status.js';

describe('search proposal status label', () => {
  it('names a demo proposal with the word the proposals list uses', () => {
    // WHY: the Siemens technical proposal is stored as review. Search printed
    // that token, so the row read as a field name instead of In review.
    expect(searchProposalStatusLabel('review')).toBe('In review');
    expect(searchProposalStatusLabel('draft')).toBe('Draft');
    expect(searchProposalStatusLabel('approved')).toBe('Approved');
    expect(searchProposalStatusLabel('submitted')).toBe('Submitted');
    expect(searchProposalStatusLabel('won')).toBe('Won');
    expect(searchProposalStatusLabel('lost')).toBe('Lost');
  });

  it('keeps a status the proposals list does not name', () => {
    // WHY: a prettified unknown token would invent a status. The stored
    // word stays, and a blank does not become a label.
    expect(searchProposalStatusLabel('custom_hold')).toBe('custom_hold');
    expect(searchProposalStatusLabel('  review  ')).toBe('In review');
    expect(searchProposalStatusLabel('')).toBe('');
    expect(searchProposalStatusLabel(null)).toBe('');
    expect(searchProposalStatusLabel(undefined)).toBe('');
  });

  it('the search route puts that word on the proposal row', () => {
    // WHY: a helper the route does not call still leaves review on the
    // Siemens technical proposal.
    const src = readFileSync(new URL('../routes/search.ts', import.meta.url), 'utf8');
    expect(src).toContain('searchProposalStatusLabel(p.status)');
    expect(src).not.toMatch(/subtitle:\s*p\.status/);
  });
});
