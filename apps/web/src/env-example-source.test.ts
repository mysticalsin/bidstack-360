import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

// apps/web/src -> apps/web -> repo root
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const example = resolve(root, '.env.example');

describe('.env.example is safe to source', () => {
  it('has no UTF-8 BOM and bash `set -a; source .env.example` exits 0', () => {
    const bytes = readFileSync(example);
    const problems: string[] = [];
    if (bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))) {
      problems.push('UTF-8 BOM');
    }
    try {
      execFileSync('bash', ['-c', 'set -a; source "$1"', 'bash', example], { encoding: 'utf8' });
    } catch (err) {
      const failed = err as { status?: number; stderr?: string };
      problems.push(`source exit ${failed.status ?? 'unknown'}: ${failed.stderr ?? ''}`);
    }
    expect(problems).toEqual([]);
  });
});
