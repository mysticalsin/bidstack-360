// A missing approval_gates table substitutes 0, and a failed probe does the
// same. The open-approvals card then says Ready and 0. That count has not
// arrived. A settled zero is the only Ready card.
import { describe, expect, it } from 'vitest';

import { approvalGateCountCard, approvalGateCountPhase } from './serum-approval-count.js';

const NONE = 'No pending human gates from existing approval workflows.';
const SETTLED = 'Human review gates awaiting a decision.';
const UNREAD = 'Approval gates have not been read. The pending count has not arrived.';
const FAILED = 'Could not load approval gates. The pending count has not arrived.';

describe('approval gate count read', () => {
  it('does not call a missing approval_gates table a ready zero', () => {
    // WHY: signalSql prints 0::int when the table is absent. Ready and 0 is a
    // settled count. This read never ran.
    const phase = approvalGateCountPhase({
      availabilityFailed: false,
      tableAvailable: false,
      countFailed: false,
    });
    const card = approvalGateCountCard({ phase, count: 0 });

    expect(phase).toBe('unread');
    expect(card.status).toBe('attention');
    expect(card.value).toBe('Not read');
    expect(card.detail).toBe(UNREAD);
    expect(card.status).not.toBe('ready');
    expect(card.status).not.toBe('empty');
    expect(card.value).not.toBe('0');
    expect(card.detail).not.toBe(NONE);
    expect(card.detail).not.toBe(SETTLED);
  });

  it('does not call a failed catalog probe a ready zero', () => {
    // WHY: the catalog read threw, so the fallback marks every table missing.
    // That is not evidence the gate table is absent, and it is not a count.
    const phase = approvalGateCountPhase({
      availabilityFailed: true,
      tableAvailable: false,
      countFailed: false,
    });
    const card = approvalGateCountCard({ phase, count: 0 });

    expect(phase).toBe('failed');
    expect(card.status).toBe('error');
    expect(card.value).toBe('Not loaded');
    expect(card.detail).toBe(FAILED);
    expect(card.value).not.toBe('0');
    expect(card.status).not.toBe('ready');
    expect(card.detail).not.toBe(SETTLED);
  });

  it('does not call a failed count query a ready zero', () => {
    // WHY: the table is present and the count query threw. The fallback row is
    // zeros. Error wins over that zero.
    const phase = approvalGateCountPhase({
      availabilityFailed: false,
      tableAvailable: true,
      countFailed: true,
    });
    const card = approvalGateCountCard({ phase, count: 0 });

    expect(phase).toBe('failed');
    expect(card.status).toBe('error');
    expect(card.value).toBe('Not loaded');
    expect(card.detail).toBe(FAILED);
    expect(card.value).not.toBe('0');
  });

  it('lets a failed catalog probe win over a missing table', () => {
    // WHY: both flags can be set together. The probe failed, so the card must
    // not say the table was merely unread.
    const phase = approvalGateCountPhase({
      availabilityFailed: true,
      tableAvailable: false,
      countFailed: true,
    });
    const card = approvalGateCountCard({ phase, count: 0 });

    expect(phase).toBe('failed');
    expect(card.status).toBe('error');
    expect(card.detail).toBe(FAILED);
    expect(card.detail).not.toBe(UNREAD);
  });

  it('keeps a settled zero on Ready', () => {
    // WHY: the table was read and the count is zero. That is a real miss, not
    // a substituted zero.
    const phase = approvalGateCountPhase({
      availabilityFailed: false,
      tableAvailable: true,
      countFailed: false,
    });
    const card = approvalGateCountCard({ phase, count: 0 });

    expect(phase).toBe('ready');
    expect(card).toEqual({
      value: '0',
      detail: SETTLED,
      status: 'ready',
    });
  });

  it('keeps a settled pending count active', () => {
    // WHY: a count that arrived above zero stays a pending gate total.
    const phase = approvalGateCountPhase({
      availabilityFailed: false,
      tableAvailable: true,
      countFailed: false,
    });
    const card = approvalGateCountCard({ phase, count: 3 });

    expect(phase).toBe('ready');
    expect(card).toEqual({
      value: '3',
      detail: SETTLED,
      status: 'active',
    });
  });
});
