import { describe, expect, it } from 'vitest';

import { oauthFailureFields, oauthFailureMessage } from './oauth-failure.js';

const LEAK = JSON.stringify({
  error: 'invalid_grant',
  error_description: 'code was already used',
  access_token: 'ya29.synthetic-access',
  refresh_token: 'synthetic-refresh',
  code: 'synthetic-auth-code',
});

describe('oauth token-failure text', () => {
  it('keeps the status and error code and drops the provider body', () => {
    const fields = oauthFailureFields(400, LEAK);
    const message = oauthFailureMessage('Gmail', 400, LEAK);
    const rendered = `${message} ${JSON.stringify(fields)}`;
    expect(fields).toEqual({ status: 400, error: 'invalid_grant' });
    expect(message).toBe('Gmail token exchange failed (400: invalid_grant)');
    expect(rendered).not.toContain('ya29.synthetic-access');
    expect(rendered).not.toContain('synthetic-refresh');
    expect(rendered).not.toContain('synthetic-auth-code');
    expect(rendered).not.toContain('error_description');
  });

  it('drops an error value that is not a short code', () => {
    const body = JSON.stringify({ error: 'access_token=ya29.synthetic-access' });
    expect(oauthFailureFields(401, body).error).toBeNull();
    expect(oauthFailureMessage('DocuSign', 401, body)).toBe(
      'DocuSign token exchange failed (401)',
    );
  });
});
