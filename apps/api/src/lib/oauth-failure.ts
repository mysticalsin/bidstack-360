// Provider token endpoints answer failures with a JSON body that can echo
// access_token, refresh_token, or the authorization code. Logs and thrown
// errors keep the HTTP status and, when present, a short error code. They
// never keep the raw body.

const ERROR_CODE = /^[A-Za-z0-9_.:-]{1,64}$/;

export function oauthFailureFields(
  status: number,
  body: string,
): { status: number; error: string | null } {
  let error: string | null = null;
  const trimmed = body.trim();
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as { error?: unknown };
      if (typeof parsed.error === 'string' && ERROR_CODE.test(parsed.error)) {
        error = parsed.error;
      }
    } catch {
      error = null;
    }
  }
  return { status, error };
}

export function oauthFailureMessage(provider: string, status: number, body: string): string {
  const { error } = oauthFailureFields(status, body);
  return error
    ? `${provider} token exchange failed (${status}: ${error})`
    : `${provider} token exchange failed (${status})`;
}
