import { describe, expect, it } from 'vitest';

import { buyerNamesAccount } from './bid-name';

describe('buyerNamesAccount', () => {
  it('matches the account as a word and skips a name that only contains those letters', () => {
    // WHY: a contains search put a KNOS bid on the NOS timeline.
    expect(buyerNamesAccount('NOS, SGPS, S.A.', 'NOS')).toBe(true);
    expect(buyerNamesAccount('nos systems', 'NOS')).toBe(true);
    expect(buyerNamesAccount('KNOS', 'NOS')).toBe(false);
    expect(buyerNamesAccount('Diagnostic NOS', 'NOS')).toBe(true);
    expect(buyerNamesAccount('Pacme Holdings', 'Acme')).toBe(false);
    expect(buyerNamesAccount('Acme Corp', 'Acme')).toBe(true);
    expect(buyerNamesAccount(null, 'NOS')).toBe(false);
    expect(buyerNamesAccount('NOS', '  ')).toBe(false);
  });
});
