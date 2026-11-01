import { describe, expect, it } from 'vitest';

import { buildValuePanel } from './value-panel.js';

describe('buildValuePanel', () => {
  it('lists uncovered IT, a renewal window and weak clauses with citations or absence', () => {
    const panel = buildValuePanel(
      {
        msaId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        expiryDate: new Date(Date.now() + 40 * 86_400_000).toISOString(),
        noticeDeadline: new Date(Date.now() + 20 * 86_400_000).toISOString(),
        autoRenew: true,
        liabilityCapMicros: 250_000_000_000,
        liabilityCapCurrency: 'EUR',
        paymentTerms: 'Net 60 days from invoice',
        indexation: 'There is no indexation.',
        exclusivity: 'Client appoints Supplier as exclusive provider of health economics services',
        nonSolicit: 'Neither party shall solicit employees for 24 months after expiry',
        scopeOfServices: 'Health economics. The scope does not include information technology.',
        citations: {
          liabilityCap: { page: 1, clause: 'Clause 7', excerpt: 'capped at 250,000 EUR' },
          paymentTerms: { page: 1, clause: 'Clause 6', excerpt: 'net 60 days' },
          exclusivity: { page: 1, clause: 'Clause 12', excerpt: 'exclusive provider' },
          nonSolicit: { page: 1, clause: 'Clause 11', excerpt: '24 months' },
          indexation: { page: 1, clause: 'Clause 5', excerpt: 'no indexation' },
        },
      },
      [
        { line: 'it', brandName: 'Amaris Consulting' },
        { line: 'health_economics', brandName: 'HEMA' },
      ],
      { name: 'Alex Buyer', title: 'Procurement', email: 'alex@northwind-pharma.example' },
    );
    const kinds = panel.items.map((i) => i.id);
    expect(kinds).toContain('uncovered:it');
    expect(kinds).toContain('renewal:expiry');
    expect(kinds).toContain('weak:liability-low');
    expect(kinds).toContain('weak:payment-long');
    expect(kinds).toContain('weak:indexation');
    expect(kinds).toContain('weak:exclusivity');
    expect(kinds).toContain('weak:nonsolicit');
    expect(panel.items.find((i) => i.id === 'weak:liability-low')?.citation?.clause).toBe('Clause 7');
    expect(panel.items.find((i) => i.id === 'uncovered:it')?.approach?.name).toBe('Alex Buyer');
  });
});
