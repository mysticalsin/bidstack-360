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
  it('defaults to real and refuses stub auth with that real data', () => {
    delete process.env.POLO_DATA_MODE;
    expect(getPoloDataMode({})).toBe('real');
    expect(() => assertPoloAuthBoot({ NODE_ENV: 'development' })).toThrow(
      /Stub auth cannot boot with real data/,
    );
  });

  it('allows stub auth only for local synthetic data', () => {
    expect(() =>
      assertPoloAuthBoot({ POLO_DATA_MODE: 'demo', NODE_ENV: 'development' }),
    ).not.toThrow();
    expect(resolvePoloAuthProvider({ POLO_DATA_MODE: 'demo', NODE_ENV: 'development' })).toBe('stub');
  });

  it('allows Cloudflare Access as the real-mode identity source', () => {
    expect(() =>
      assertPoloAuthBoot({
        POLO_DATA_MODE: 'real',
        CF_ACCESS_AUTH: 'true',
        NODE_ENV: 'production',
      }),
    ).not.toThrow();
    expect(resolvePoloAuthProvider({ CF_ACCESS_AUTH: 'true', NODE_ENV: 'production' })).toBe('cf-access');
  });

  it('keeps demo and Access mutually exclusive', () => {
    expect(() =>
      assertPoloAuthBoot({ DEMO_MODE: 'true', CF_ACCESS_AUTH: 'true' }),
    ).toThrow(/DEMO_MODE cannot run with CF_ACCESS_AUTH/);
  });
});
