import { describe, expect, it } from 'vitest';

import { sessionBannerIdentity } from './session-banner';

const copy = {
  guest: 'Guest',
  signedInNoName: 'Signed in',
  notSignedIn: 'Not signed in',
  noEmail: 'No email on file',
};

describe('session banner identity', () => {
  it('does not call an empty demo sign-out an admin', () => {
    // WHY: the topbar is the session banner. Demo auth used to keep role
    // admin after the user was cleared, so an empty sign-out still showed
    // an admin chip next to Not signed in.
    expect(
      sessionBannerIdentity({
        signedIn: false,
        fullName: null,
        email: null,
        role: 'admin',
        ...copy,
      }),
    ).toEqual({
      name: 'Guest',
      detail: 'Not signed in',
      role: null,
    });
  });

  it('does not say a signed-in demo session with no email is signed out', () => {
    // WHY: a demo token can exist before an email is stored. The banner used
    // the missing email as Not signed in. Empty is not a sign-out, and it is
    // not the guest label either.
    expect(
      sessionBannerIdentity({
        signedIn: true,
        fullName: '   ',
        email: null,
        role: ' admin ',
        ...copy,
      }),
    ).toEqual({
      name: 'Signed in',
      detail: 'No email on file',
      role: 'admin',
    });
  });

  it('keeps a named signed-in session and its email', () => {
    // WHY: the empty-session fix is only for a missing identity. A Clerk or
    // demo session that has a name and an email still shows both, and still
    // shows the role.
    expect(
      sessionBannerIdentity({
        signedIn: true,
        fullName: 'Ada Visitor',
        email: 'ada.visitor@example.test',
        role: 'admin',
        ...copy,
      }),
    ).toEqual({
      name: 'Ada Visitor',
      detail: 'ada.visitor@example.test',
      role: 'admin',
    });
  });
});
