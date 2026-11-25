import { describe, expect, it } from 'vitest';

import { contactListSearchOr } from './contact-list-search.js';

describe('contact list search', () => {
  it('keeps a name on the plaintext columns and off the encrypted email column', () => {
    // "Klaus Vogt" is the demo Siemens contact. That search must stay a
    // substring match and must not touch email — a contains there 500s the list.
    expect(contactListSearchOr('Klaus Vogt')).toEqual([
      { name: { contains: 'Klaus Vogt', mode: 'insensitive' } },
      { customer: { contains: 'Klaus Vogt', mode: 'insensitive' } },
      { role: { contains: 'Klaus Vogt', mode: 'insensitive' } },
    ]);
  });

  it('finds the address printed on a demo contact row by equality, not by a substring', () => {
    // The contacts table shows klaus.vogt.<namespace>@example.com. Pasting that
    // address used to match nothing, because email was left out of the OR.
    // contains is forbidden: the encryption middleware rejects it.
    const address = 'klaus.vogt.demo@example.com';
    const clauses = contactListSearchOr(`  ${address.toUpperCase()}  `);
    expect(clauses).toContainEqual({ email: { equals: address.toUpperCase() } });
    expect(clauses.some((clause) => JSON.stringify(clause).includes('"contains"') && 'email' in clause)).toBe(
      false,
    );
  });

  it('does not query a fragment of an address or a phone number', () => {
    // "klaus.vogt@" is not a full address. Phone is encrypted and has no hash
    // column, so either lookup would 500 the list or match the wrong column.
    for (const term of ['klaus.vogt@', 'vogt@example', '+49 30 1234 5670']) {
      const clauses = contactListSearchOr(term);
      expect(clauses.some((clause) => 'email' in clause || 'phone' in clause)).toBe(false);
    }
  });
});
