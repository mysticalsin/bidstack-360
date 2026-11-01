import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { SLUG_ACCOUNT_CUSTOMER_KEY_SQL } from './dashboard.queries.js';
import {
  normalizeName,
  OPPORTUNITY_CUSTOMER_KEY_SQL,
  opportunityCustomerKeySql,
} from './dashboard.utils.js';

describe('opportunity customer key', () => {
  it('uses the same slug the cockpit stores for a customer-only company', () => {
    // WHY: the cockpit scanned the newest 1000 customer names and returned
    // 404 for any account outside that page.
    expect(normalizeName('Acme Corp')).toBe('acme-corp');
    expect(normalizeName('  ACME   Corp! ')).toBe('acme-corp');
    expect(normalizeName('---')).toBe('');
    expect(OPPORTUNITY_CUSTOMER_KEY_SQL).toBe(
      "trim(both '-' from regexp_replace(lower(btrim(customer)), '[^a-z0-9]+', '-', 'g'))",
    );
  });

  it('uses that same expression for the slug book, qualified as o.customer', () => {
    // WHY: the book query aliases opportunities as o and joins territories.
    // A bare `customer`, or a second slug expression, drops the deals.
    expect(opportunityCustomerKeySql()).toBe(OPPORTUNITY_CUSTOMER_KEY_SQL);
    expect(SLUG_ACCOUNT_CUSTOMER_KEY_SQL).toBe(opportunityCustomerKeySql('o.customer'));
    expect(SLUG_ACCOUNT_CUSTOMER_KEY_SQL).toBe(
      "trim(both '-' from regexp_replace(lower(btrim(o.customer)), '[^a-z0-9]+', '-', 'g'))",
    );
    expect(normalizeName('Rush University System for Health')).toBe(
      'rush-university-system-for-health',
    );
    const source = readFileSync(new URL('./dashboard.queries.ts', import.meta.url), 'utf8');
    expect(source).toContain('Prisma.raw(SLUG_ACCOUNT_CUSTOMER_KEY_SQL)');
  });
});
