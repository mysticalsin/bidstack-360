import { afterEach, describe, expect, it } from 'vitest';

import { consumeCrash, crashSignature, resetCrashGuardForTests } from './crash-guard';

afterEach(() => {
  resetCrashGuardForTests();
});

describe('crash guard', () => {
  it('reports and reloads a signature once, then stays quiet', () => {
    const storage = new Map<string, string>();
    const session = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
    } as Storage;

    const signature = crashSignature('Cannot read properties', 'at Dashboard', '/dashboard');
    const first = consumeCrash(signature, session);
    const second = consumeCrash(signature, session);

    // WHY: a crash loop must tell admins once and restart at most once.
    // The same signature after that stays on the fallback.
    expect(first).toEqual({ report: true, reload: true });
    expect(second).toEqual({ report: false, reload: false });
  });

  it('does not reload when the flag cannot be remembered', () => {
    const blocked = {
      getItem: () => {
        throw new Error('storage blocked');
      },
      setItem: () => {
        throw new Error('storage blocked');
      },
    } as unknown as Storage;

    const first = consumeCrash('abc12345', blocked);
    const second = consumeCrash('abc12345', blocked);

    // WHY: reloading without a persisted flag would restart forever.
    expect(first).toEqual({ report: true, reload: false });
    expect(second).toEqual({ report: false, reload: false });
  });

  it('treats a different error as a new crash', () => {
    const storage = new Map<string, string>();
    const session = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
    } as Storage;

    const left = crashSignature('A', 'at A', '/a');
    const right = crashSignature('B', 'at B', '/b');
    consumeCrash(left, session);

    expect(consumeCrash(right, session)).toEqual({ report: true, reload: true });
  });
});
