// WHY: Inspector and Sentinel rejected the first review of the database boot.
// Each case below fails on the code they named, before that case is fixed.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const entry = readFileSync(join(here, '../container/entrypoint.mjs'), 'utf8');

function functionBody(source: string, name: string): string {
  const start = source.indexOf(`function ${name}(`);
  const next = source.indexOf('\nfunction ', start + 1);
  return source.slice(start, next === -1 ? undefined : next);
}

function callBody(source: string, openParen: number): string {
  let depth = 0;
  for (let i = openParen; i < source.length; i += 1) {
    if (source[i] === '(') depth += 1;
    else if (source[i] === ')') {
      depth -= 1;
      if (depth === 0) return source.slice(openParen, i + 1);
    }
  }
  return source.slice(openParen);
}

describe('database boot review', () => {
  it('passes -v VERBOSITY=verbose on the password psql argv', () => {
    // WHY: PGVERBOSITY in the environment does not make psql 16 print the
    // SQLSTATE. The child has to receive -v VERBOSITY=verbose, and that argv
    // must still not carry the password or the SCRAM verifier.
    const body = functionBody(entry, 'setAppRolePassword');
    const spawnAt = body.indexOf('spawnSync');
    const spawn = callBody(body, body.indexOf('(', spawnAt));
    const secret = "fix'ture\\pass";
    expect(spawn).toContain('VERBOSITY=verbose');
    expect(spawn).toContain("'-v'");
    expect(spawn).not.toContain(secret);
    expect(spawn).not.toContain('SCRAM-SHA-256$');
    expect(spawn).not.toMatch(/['"]-c['"]/);
  });
});
