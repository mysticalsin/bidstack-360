import { describe, expect, it } from 'vitest';

import { workflowAccessPhase } from './workflow-access-read';

const PERMISSION = 'workflows:write';

describe('workflowAccessPhase', () => {
  it('treats a missing manifest as unread, including a paused read', () => {
    // WHY: isLoading is false while the first fetch is paused. No manifest
    // is not a denial, and it is not a grant.
    expect(workflowAccessPhase({ status: 'pending', isError: false }, PERMISSION)).toBe('unread');
    expect(workflowAccessPhase({}, PERMISSION)).toBe('unread');
  });

  it('treats a failed read as failed even if a stale body is still attached', () => {
    // WHY: a network error is not evidence the grant is missing, and it
    // must not fall through to allowed because an old body is still present.
    expect(
      workflowAccessPhase(
        {
          status: 'error',
          isError: true,
          data: { isAdmin: true, permissions: [PERMISSION] },
        },
        PERMISSION,
      ),
    ).toBe('failed');
  });

  it('allows an admin or a manifest that includes the grant', () => {
    expect(
      workflowAccessPhase(
        { status: 'success', data: { isAdmin: true, permissions: [] } },
        PERMISSION,
      ),
    ).toBe('allowed');
    expect(
      workflowAccessPhase(
        { status: 'success', data: { isAdmin: false, permissions: [PERMISSION] } },
        PERMISSION,
      ),
    ).toBe('allowed');
  });

  it('denies a settled manifest that lacks the grant', () => {
    expect(
      workflowAccessPhase(
        { status: 'success', data: { isAdmin: false, permissions: ['workflows:read'] } },
        PERMISSION,
      ),
    ).toBe('denied');
  });
});
