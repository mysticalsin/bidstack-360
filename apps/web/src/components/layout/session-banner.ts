export interface SessionBannerIdentity {
  name: string;
  detail: string;
  role: string | null;
}

function trimmed(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * The topbar is the session banner.
 * An empty sign-out is not an admin, and a signed-in session with no email
 * is not signed out. A blank name stays blank in words.
 */
export function sessionBannerIdentity(input: {
  signedIn: boolean;
  fullName: string | null | undefined;
  email: string | null | undefined;
  role: string | null | undefined;
  guest: string;
  signedInNoName: string;
  notSignedIn: string;
  noEmail: string;
}): SessionBannerIdentity {
  if (!input.signedIn) {
    return { name: input.guest, detail: input.notSignedIn, role: null };
  }
  const email = trimmed(input.email);
  const name = trimmed(input.fullName);
  const role = trimmed(input.role);
  return {
    name: name || email || input.signedInNoName,
    detail: email || input.noEmail,
    role: role.length > 0 ? role : null,
  };
}
