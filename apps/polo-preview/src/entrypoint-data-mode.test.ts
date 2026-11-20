import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const src = readFileSync(new URL('../container/entrypoint.mjs', import.meta.url), 'utf8');

describe('preview entrypoint data mode', () => {
  it('does not force demo after it copies the environment', () => {
    // WHY: the container was stamping POLO_DATA_MODE=demo on top of whatever
    // the operator passed, so the preview could not run real. Unset has to
    // stay unset and fall through to the real default. The org Demo data
    // switch is not a process variable, so the entrypoint must not set one.
    const fn = src.slice(src.indexOf('function runtimeEnv'), src.indexOf('function migrateEnv'));
    expect(fn).toContain('...process.env');
    expect(fn).not.toMatch(/POLO_DATA_MODE\s*:/);
  });
});
