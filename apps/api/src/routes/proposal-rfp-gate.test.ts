import { describe, expect, it } from 'vitest';

import { rfpLinkedApprovalBlock } from './proposal-rfp-gate.js';

describe('generic proposal approval and the RFP gate', () => {
  it('leaves an ordinary proposal on this route', () => {
    expect(rfpLinkedApprovalBlock(null)).toBeNull();
    expect(rfpLinkedApprovalBlock(undefined)).toBeNull();
    expect(rfpLinkedApprovalBlock('')).toBeNull();
  });

  it('refuses a linked orchestration so approvedAt is not set before the RFP gate', () => {
    const message = rfpLinkedApprovalBlock('00000000-0000-4000-8000-000000000010');
    expect(message).toContain('POST /api/v1/proposals/:id/rfp-approve');
    expect(message).toContain('leave that gate unreachable');
  });
});
