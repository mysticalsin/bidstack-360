// Environment handed to the Polo container. Pure, so it is unit tested.

export function allowedUsersFromEmails(emails, admins) {
  const adminSet = new Set(admins.map((e) => e.trim().toLowerCase()).filter(Boolean));
  return String(emails || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
    .map((e) => `${e}:${adminSet.has(e) ? 'Admin' : 'Sales Manager'}`)
    .join(',');
}

export function containerEnv(env) {
  const origin = env.PUBLIC_ORIGIN || 'https://polo-preview.tony-walteur.workers.dev';
  const missing = [
    'POLO_INTERNAL_KEY',
    'POLO_INTEGRATION_TOKEN_KEY',
    'POLO_PII_ENCRYPTION_MASTER_KEY',
    'POLO_JOB_SIGNING_SECRET',
  ].filter((name) => !env[name]);
  if (missing.length) throw new Error(`polo-preview is missing Worker secrets: ${missing.join(', ')}`);
  return {
    POLO_INTERNAL_KEY: env.POLO_INTERNAL_KEY,
    PUBLIC_BASE_URL: origin,
    PUBLIC_API_URL: origin,
    CF_ACCESS_AUD: env.ACCESS_AUD || '',
    CF_ACCESS_TRUST_LOOPBACK_EMAIL: 'false',
    POLO_ALLOWED_USERS: allowedUsersFromEmails(env.ALLOWED_EMAILS, String(env.POLO_ADMIN_EMAILS || '').split(',')),
    INTEGRATION_TOKEN_KEY: env.POLO_INTEGRATION_TOKEN_KEY,
    PII_ENCRYPTION_MASTER_KEY: env.POLO_PII_ENCRYPTION_MASTER_KEY,
    BIDSTACK_JOB_SIGNING_SECRET: env.POLO_JOB_SIGNING_SECRET,
    ...(env.POLO_INTEL_USER_AGENT ? { POLO_INTEL_USER_AGENT: env.POLO_INTEL_USER_AGENT } : {}),
    ...(env.COMPANIES_HOUSE_API_KEY ? { COMPANIES_HOUSE_API_KEY: env.COMPANIES_HOUSE_API_KEY } : {}),
  };
}
