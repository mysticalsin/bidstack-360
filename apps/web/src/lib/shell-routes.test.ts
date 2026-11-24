import { describe, expect, it } from 'vitest';

import { isShellLessPath } from './shell-routes';

describe('isShellLessPath', () => {
  it('keeps the CRM shell off public booking and every login step', () => {
    // A guest on /book/:slug must not see the workspace rail. Clerk factor
    // steps are /login/*, so an exact /login check leaves those inside the shell.
    expect(isShellLessPath('/book/test-slug')).toBe(true);
    expect(isShellLessPath('/login')).toBe(true);
    expect(isShellLessPath('/login/factor-two')).toBe(true);
    expect(isShellLessPath('/sign/test-sign-token')).toBe(true);
  });

  it('keeps workspace routes inside the shell', () => {
    expect(isShellLessPath('/dashboard')).toBe(false);
    expect(isShellLessPath('/booking')).toBe(false);
    expect(isShellLessPath('/signatures')).toBe(false);
  });
});
