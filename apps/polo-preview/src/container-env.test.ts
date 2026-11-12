import { describe, expect, it } from 'vitest';

import { allowedUsersFromEmails, containerEnv } from './container-env.js';

const SECRETS = {
  POLO_INTERNAL_KEY: 'k',
  POLO_INTEGRATION_TOKEN_KEY: 'a'.repeat(64),
  POLO_PII_ENCRYPTION_MASTER_KEY: 'b'.repeat(64),
  POLO_JOB_SIGNING_SECRET: 's',
  POLO_APP_DB_PASSWORD: 'fixture-password',
};

describe('container env', () => {
  it('gives admins Admin and everyone else on the Access allowlist Sales Manager', () => {
    expect(allowedUsersFromEmails(' A@x.com,b@x.com ,,', ['a@x.com'])).toBe('a@x.com:Admin,b@x.com:Sales Manager');
  });

  it('maps Worker secrets to the API names and uses the public origin', () => {
    const env = containerEnv({
      ...SECRETS,
      ACCESS_AUD: 'aud',
      ALLOWED_EMAILS: 'a@x.com',
      POLO_ADMIN_EMAILS: 'a@x.com',
      PUBLIC_ORIGIN: 'https://polo.example',
    });
    expect(env).toMatchObject({
      PUBLIC_BASE_URL: 'https://polo.example',
      CF_ACCESS_AUD: 'aud',
      CF_ACCESS_TRUST_LOOPBACK_EMAIL: 'false',
      POLO_ALLOWED_USERS: 'a@x.com:Admin',
      INTEGRATION_TOKEN_KEY: 'a'.repeat(64),
      PII_ENCRYPTION_MASTER_KEY: 'b'.repeat(64),
      BIDSTACK_JOB_SIGNING_SECRET: 's',
      POLO_APP_DB_PASSWORD: 'fixture-password',
    });
  });

  it('passes the public-registry contact User-Agent and optional Companies House key through', () => {
    expect(containerEnv({ ...SECRETS, ALLOWED_EMAILS: 'a@x.com' })).not.toHaveProperty('POLO_INTEL_USER_AGENT');
    expect(
      containerEnv({ ...SECRETS, ALLOWED_EMAILS: 'a@x.com', POLO_INTEL_USER_AGENT: 'Polo ua', COMPANIES_HOUSE_API_KEY: 'ch' }),
    ).toMatchObject({ POLO_INTEL_USER_AGENT: 'Polo ua', COMPANIES_HOUSE_API_KEY: 'ch' });
  });

  it('refuses to start without the encryption secrets instead of booting with blank keys', () => {
    expect(() => containerEnv({ ALLOWED_EMAILS: 'a@x.com' })).toThrow(/POLO_PII_ENCRYPTION_MASTER_KEY/);
  });

  it('names the app database secret and does not repeat a password in the error', () => {
    expect(() => containerEnv({ ...SECRETS, POLO_APP_DB_PASSWORD: '' })).toThrow(
      /^polo-preview is missing Worker secrets: POLO_APP_DB_PASSWORD$/,
    );
  });
});
