// Demo auth on the client reports the placeholder id "demo-user"
// (apps/web/src/lib/auth.tsx). The session token this app stored is
// `demo_<base64url(json)>.<sig>`, and that json carries the real user id
// in `u`, the same id the presence row uses. Presence self-exclusion has
// to read it, or a person alone on a bid is painted as a teammate.
//
// The signature is not checked here. The browser does not hold the
// session secret, and this id only hides the caller's own avatar.
// Request auth stays on the server.

// Same key as DEMO_TOKEN_KEY in auth.tsx. Kept here so presence can read
// it without importing the auth module (tests mock that module).
export const DEMO_SESSION_TOKEN_KEY = 'bidstack:demo-token';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function demoSessionUserId(token: string | null | undefined): string | null {
  if (!token?.startsWith('demo_')) return null;
  const rest = token.slice('demo_'.length);
  const dot = rest.indexOf('.');
  if (dot <= 0) return null;
  const body = rest.slice(0, dot);
  try {
    const b64 = body.replaceAll('-', '+').replaceAll('_', '/');
    const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
    const payload: unknown = JSON.parse(atob(b64 + pad));
    if (!payload || typeof payload !== 'object' || !('u' in payload)) return null;
    const userId = (payload as { u: unknown }).u;
    return typeof userId === 'string' && UUID_RE.test(userId) ? userId : null;
  } catch {
    return null;
  }
}

export function readDemoSessionUserId(): string | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    return demoSessionUserId(localStorage.getItem(DEMO_SESSION_TOKEN_KEY));
  } catch {
    return null;
  }
}
