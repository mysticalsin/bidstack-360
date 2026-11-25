import { describe, expect, it } from 'vitest';

import { openIssuesPosture } from './open-issues-posture';

describe('openIssuesPosture', () => {
  it('treats an empty file as unrecorded, because nothing on file is not a clean bill of health', () => {
    expect(openIssuesPosture(0, 0)).toBe('unrecorded');
  });

  it('treats a register with nothing still open as clear', () => {
    // WHY: mitigated risks and compliant checks are a closed file. That is
    // "all clear", and it is a different sentence from an empty file.
    expect(openIssuesPosture(2, 0)).toBe('clear');
  });

  it('treats any open row as work to action', () => {
    expect(openIssuesPosture(3, 1)).toBe('open');
  });
});
