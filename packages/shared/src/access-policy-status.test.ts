import { describe, expect, it } from 'vitest';

import {
  ACCESS_POLICY_STATUSES,
  accessPolicyFromStatuses,
  accessPolicyStatusAfter,
  accessPolicyTransition,
} from './access-policy-status.js';

const EVENTS = ['submit', 'withdraw', 'approve', 'reject', 'publish', 'supersede'] as const;

const LEGAL: Record<(typeof EVENTS)[number], Partial<Record<(typeof ACCESS_POLICY_STATUSES)[number], string>>> = {
  submit: { draft: 'pending', rejected: 'pending' },
  withdraw: { pending: 'draft' },
  approve: { pending: 'approved' },
  reject: { pending: 'rejected' },
  publish: { approved: 'published' },
  supersede: { published: 'superseded' },
};

describe('access policy transitions', () => {
  it('allows exactly the moves in the table', () => {
    for (const event of EVENTS) {
      for (const from of ACCESS_POLICY_STATUSES) {
        const to = LEGAL[event][from];
        const result = accessPolicyTransition(from, event);
        if (to) {
          expect(result).toEqual({ ok: true, to });
          expect(accessPolicyStatusAfter(from, event)).toBe(to);
          expect(accessPolicyFromStatuses(event)).toContain(from);
        } else {
          expect(result.ok, `${from} -${event}->`).toBe(false);
        }
      }
    }
  });

  it('refuses publishing a draft and approving something already published', () => {
    // WHY: those two were the ways a policy skipped the second admin.
    expect(accessPolicyTransition('draft', 'publish').ok).toBe(false);
    expect(accessPolicyTransition('published', 'approve').ok).toBe(false);
    expect(accessPolicyTransition('superseded', 'publish').ok).toBe(false);
  });
});
