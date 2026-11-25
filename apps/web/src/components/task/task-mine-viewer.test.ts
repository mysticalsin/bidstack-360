// Mine is the signed-in person's follow-ups. Demo sign-in stores the session
// address beside the token. The auth snapshot can keep the previous address
// after that session is replaced, and Mine must not keep the previous rows.
import { describe, expect, it } from 'vitest';

import { isOwnFollowUp, mineViewerEmail } from './task-mine-viewer';

const FIRST = 'visitor.one@example.test';
const SECOND = 'visitor.two@example.test';

describe('mineViewerEmail', () => {
  it('uses the demo session address when the auth snapshot is still the previous person', () => {
    // WHY: a second demo sign-in replaces the stored address without a new
    // auth render. Mine that trusts the snapshot keeps the first person's rows.
    expect(mineViewerEmail(FIRST, SECOND)).toBe(SECOND);
  });

  it('uses the auth address when this session is not a demo door', () => {
    expect(mineViewerEmail(FIRST, null)).toBe(FIRST);
    expect(mineViewerEmail(`  ${FIRST.toUpperCase()}  `, '   ')).toBe(FIRST);
  });

  it('matches a follow-up only when the assignee is that address', () => {
    expect(isOwnFollowUp({ assignee: ` ${SECOND.toUpperCase()} ` }, SECOND)).toBe(true);
    expect(isOwnFollowUp({ assignee: FIRST }, SECOND)).toBe(false);
    expect(isOwnFollowUp({ assignee: null }, SECOND)).toBe(false);
    expect(isOwnFollowUp({ assignee: SECOND }, null)).toBe(false);
  });
});
