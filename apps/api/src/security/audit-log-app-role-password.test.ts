// WHY: Postgres 16 with scram rejects an empty app_role password. The
// privilege test has to take a test-only password from the environment.
// An empty password is not a stand-in for that secret.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));

describe('app role test password', () => {
  it('takes the role secret from a test-only env var', () => {
    const source = readFileSync(resolve(here, 'audit-log-app-role.integration.test.ts'), 'utf8');
    expect(source).toContain('APP_ROLE_TEST_PASSWORD');
    expect(source).not.toMatch(/url\.password\s*=\s*['"]['"]/);
    expect(source).toMatch(/scram rejects an empty password/);
  });
});
