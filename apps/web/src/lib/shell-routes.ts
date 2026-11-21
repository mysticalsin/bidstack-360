/**
 * Routes that render without the CRM shell (sidebar, top bar, demo banner).
 *
 * Public signing already opts out. Public booking must too: a guest opening
 * /book/:slug is not a signed-in user, and the shell paints Jane Smith and
 * the workspace nav around the calendar. Clerk's login sub-steps live under
 * /login/*, so the prefix has to match, not only the exact /login path.
 */
export function isShellLessPath(pathname: string): boolean {
  return (
    pathname === '/login' ||
    pathname.startsWith('/login/') ||
    pathname.startsWith('/sign/') ||
    pathname.startsWith('/book/')
  );
}
