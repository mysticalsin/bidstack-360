import { describe, expect, it } from 'vitest';

import { resolveSignatureTransition } from './signatures.js';

// The poll path commits a DocuSign envelope status onto a SignatureRequest. The
// guard exists because DocuSign Connect webhooks (and our 6-hourly sweeper) can
// replay or arrive out of order — so an INVALID transition must be rejected
// before it writes a duplicate signatureEvent or an illegal status flip. These
// tests encode WHY each class of transition is allowed or rejected.
describe('resolveSignatureTransition', () => {
  it('allows a valid terminal transition (SENT → SIGNED)', () => {
    // The normal happy path: an outstanding request completes.
    expect(resolveSignatureTransition('SENT', 'completed')).toBe('SIGNED');
    expect(resolveSignatureTransition('SENT', 'declined')).toBe('DECLINED');
    expect(resolveSignatureTransition('VIEWED', 'voided')).toBe('VOIDED');
  });

  it('rejects a no-op transition into the SAME status (prevents duplicate events)', () => {
    // WHY: a replayed webhook for an already-SIGNED envelope must NOT write a
    // second SIGNED signatureEvent. Same-status transitions are rejected.
    expect(resolveSignatureTransition('SIGNED', 'completed')).toBeNull();
    expect(resolveSignatureTransition('DECLINED', 'declined')).toBeNull();
    expect(resolveSignatureTransition('VOIDED', 'voided')).toBeNull();
  });

  it('rejects an unmapped DocuSign status', () => {
    // WHY: DocuSign may report statuses we do not model (e.g. "timedout").
    // Acting on an unknown status would set a request to `undefined` — rejected.
    expect(resolveSignatureTransition('SENT', 'timedout')).toBeNull();
    expect(resolveSignatureTransition('SENT', '')).toBeNull();
  });

  it('rejects a non-terminal transition via the poll path', () => {
    // WHY: the poll only commits terminal states (SIGNED/DECLINED/VOIDED). A
    // "sent"/"delivered" envelope maps to the non-terminal SENT, which the poll
    // must NOT write — that lifecycle is owned by the send path, not the poller.
    expect(resolveSignatureTransition('DRAFT', 'sent')).toBeNull();
    expect(resolveSignatureTransition('SENT', 'delivered')).toBeNull();
  });
});
