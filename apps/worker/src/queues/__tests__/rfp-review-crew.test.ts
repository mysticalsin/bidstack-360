import { describe, expect, it } from 'vitest';

import { RFP_REVIEW_AGENTS } from '../rfp-legal-scan.js';

describe('RFP review crew standard roles', () => {
  it('runs the required specialist sequence before proposal compilation', () => {
    const roles = RFP_REVIEW_AGENTS.map((agent) => agent.key);

    expect(roles).toEqual(['legal', 'finance', 'marketing', 'presales', 'bid']);
    expect(new Set(RFP_REVIEW_AGENTS.map((agent) => agent.purpose)).size).toBe(
      RFP_REVIEW_AGENTS.length,
    );
  });
});
