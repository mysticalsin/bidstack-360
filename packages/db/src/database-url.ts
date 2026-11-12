// Which login a database URL uses. Error text stays free of the URL so a
// refused boot cannot write a password into the log.

type Env = Record<string, string | undefined>;

export function databaseLogin(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'postgresql:' && url.protocol !== 'postgres:') return null;
    const login = decodeURIComponent(url.username);
    return login || null;
  } catch {
    return null;
  }
}

export function appDatabaseUrl(env: Env = process.env): string {
  return env.DATABASE_URL_APP?.trim() || env.DATABASE_URL?.trim() || '';
}

export function ownerDatabaseUrl(env: Env = process.env): string {
  const owner = env.DATABASE_URL_OWNER?.trim() ?? '';
  if (owner) return owner;
  if ((env.NODE_ENV ?? '') === 'production') {
    throw new Error('DATABASE_URL_OWNER is required in production');
  }
  return env.DATABASE_URL?.trim() ?? '';
}

export function assertDistinctDatabaseLogins(appUrl: string, ownerUrl: string): void {
  const app = databaseLogin(appUrl);
  const owner = databaseLogin(ownerUrl);
  if (!app || !owner) {
    throw new Error('database URL must be a postgres URL with a login');
  }
  if (app === owner) {
    throw new Error('DATABASE_URL_APP must not use the owner login');
  }
}
