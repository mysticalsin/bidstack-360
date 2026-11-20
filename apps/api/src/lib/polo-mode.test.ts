import { afterEach, describe, expect, it } from 'vitest';

import { assertPoloAuthBoot, getPoloDataMode, resolvePoloAuthProvider } from './polo-mode.js';

const KEYS = [
  'POLO_DATA_MODE',
  'CLERK_SECRET_KEY',
  'CF_ACCESS_AUTH',
  'DEMO_MODE',
  'NODE_ENV',
] as const;

const original = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));

afterEach(() => {
  for (const key of KEYS) {
    const value = original[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('polo data mode', () => {
  it('defaults to real so an unset variable is not a fixture preview', () => {
    delete process.env.POLO_DATA_MODE;
    expect(getPoloDataMode({})).toBe('real');
    expect(resolvePoloAuthProvider({})).toBe('stub');
  });

  it('lets development boot in real mode and still refuses the stub in production', () => {
    expect(() =>
      assertPoloAuthBoot({ POLO_DATA_MODE: 'real', NODE_ENV: 'development' }),
    ).not.toThrow();
    expect(() =>
      assertPoloAuthBoot({ POLO_DATA_MODE: 'real', NODE_ENV: 'production' }),
    ).toThrow(/stub\/shared Jane Smith is disabled/);
  });

  it('allows Cloudflare Access as the real-mode identity source', () => {
    expect(() =>
      assertPoloAuthBoot({
        POLO_DATA_MODE: 'real',
        CF_ACCESS_AUTH: 'true',
        NODE_ENV: 'production',
      }),
    ).not.toThrow();
    expect(resolvePoloAuthProvider({ CF_ACCESS_AUTH: 'true' })).toBe('cf-access');
  });

  it('keeps demo and Access mutually exclusive', () => {
    expect(() =>
      assertPoloAuthBoot({ DEMO_MODE: 'true', CF_ACCESS_AUTH: 'true' }),
    ).toThrow(/DEMO_MODE cannot run with CF_ACCESS_AUTH/);
  });
});
