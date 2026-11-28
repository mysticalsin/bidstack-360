import { describe, expect, it } from 'vitest';

import { oauthFailureFields, oauthFailureMessage } from './oauth-failure.js';

// Obvious stand-ins. The redaction keeps a short error code and drops the
// rest of the body, so these strings must not survive into the message.
const FIXTURE_ACCESS = 'fixture-oauth-access-not-a-credential';
const FIXTURE_REFRESH = 'fixture-oauth-refresh-not-a-credential';
const FIXTURE_CODE = 'fixture-oauth-code-not-a-credential';

const LEAK = JSON.stringify({
  error: 'invalid_grant',
  error_description: 'code was already used',
  access_token: FIXTURE_ACCESS,
  refresh_token: FIXTURE_REFRESH,
  code: FIXTURE_CODE,
});

describe('oauth token-failure text', () => {
  it('keeps the status and error code and drops the provider body', () => {
    const fields = oauthFailureFields(400, LEAK);
    const message = oauthFailureMessage('Gmail', 400, LEAK);
    const rendered = `${message} ${JSON.stringify(fields)}`;
    expect(fields).toEqual({ status: 400, error: 'invalid_grant' });
    expect(message).toBe('Gmail token exchange failed (400: invalid_grant)');
    expect(rendered).not.toContain(FIXTURE_ACCESS);
    expect(rendered).not.toContain(FIXTURE_REFRESH);
    expect(rendered).not.toContain(FIXTURE_CODE);
    expect(rendered).not.toContain('error_description');
  });

  it('drops an error value that is not a short code', () => {
    const body = JSON.stringify({ error: `access_token=${FIXTURE_ACCESS}` });
    expect(oauthFailureFields(401, body).error).toBeNull();
    expect(oauthFailureMessage('DocuSign', 401, body)).toBe(
      'DocuSign token exchange failed (401)',
    );
  });
});
