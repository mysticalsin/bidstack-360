// Local Postgres inside the Polo container. The owner login is the initdb
// superuser and stays on migrations and retention. app_role is a different
// login. Its password is the Worker secret POLO_APP_DB_PASSWORD.

export const APP_LOGIN = 'app_role';
export const OWNER_LOGIN = 'bidstack';

export function ownerDatabaseUrl() {
  const url = new URL('postgres://127.0.0.1:5432/bidstack');
  url.username = OWNER_LOGIN;
  url.password = OWNER_LOGIN;
  return url.toString();
}

export function appDatabaseUrl(password) {
  if (!password) throw new Error('POLO_APP_DB_PASSWORD is required');
  const url = new URL(ownerDatabaseUrl());
  url.username = APP_LOGIN;
  url.password = password;
  return url.toString();
}
