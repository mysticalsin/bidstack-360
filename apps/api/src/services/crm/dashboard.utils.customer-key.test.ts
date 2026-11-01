import { describe, expect, it } from 'vitest';

import { normalizeName, OPPORTUNITY_CUSTOMER_KEY_SQL } from './dashboard.utils.js';

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
});
