import { describe, expect, it } from 'vitest';

import { serializeOpportunityToMarkdown } from './dust-integration.helpers.js';

describe('serializeOpportunityToMarkdown', () => {
  it('labels a stored zero as unrecorded instead of a measured percent', () => {
    const markdown = serializeOpportunityToMarkdown({
      name: 'Ledger Refresh',
      code: 'OP-1',
      customer: 'Northwind',
      stage: 's1_lead',
      valueMicros: 2_000_000n,
      probability: 0,
      dueDate: null,
      industry: null,
      intel: null,
    });

    expect(markdown).toContain('**Stored probability:** not recorded');
    expect(markdown).toContain('**Value (currency not recorded):** 2');
    expect(markdown).not.toContain('0%');
    expect(markdown).not.toMatch(/EUR|€/);
  });

  it('keeps a large amount on the exact cent', () => {
    const markdown = serializeOpportunityToMarkdown({
      name: 'Wide book',
      code: 'OP-2',
      customer: 'Northwind',
      stage: 's1_lead',
      valueMicros: 8_598_204_328_457_184_962n,
      probability: 40,
      dueDate: null,
      industry: null,
      intel: null,
    });

    expect(markdown).toContain('**Value (currency not recorded):** 8,598,204,328,457.18');
    expect(markdown).not.toContain('8,598,204,328,457.19');
  });
});
