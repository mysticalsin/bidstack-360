// WHY: discarding the body at each call site rots. A not-ok branch that
// throws or logs the response text has to fail in CI, including a sample
// that is not in the repo yet.

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { scanUpstreamErrorBodies } from '../../../../scripts/scan-upstream-error-body.mjs';

describe('upstream error body scan', () => {
  it('flags a not-ok branch that throws the response text', () => {
    const root = mkdtempSync(join(tmpdir(), 'upstream-scan-'));
    const dir = join(root, 'apps/api/src');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'leak.ts'),
      [
        'export async function leak(res: { ok: boolean; status: number; text(): Promise<string> }) {',
        '  if (!res.ok) {',
        '    const text = await res.text();',
        '    throw new Error(`provider failed ${text}`);',
        '  }',
        '}',
        '',
      ].join('\n'),
    );
    try {
      const failures = scanUpstreamErrorBodies(root);
      expect(failures).toEqual([
        expect.objectContaining({ file: 'apps/api/src/leak.ts', line: 2 }),
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('allows a status-only throw after the body is discarded', () => {
    const root = mkdtempSync(join(tmpdir(), 'upstream-scan-'));
    const dir = join(root, 'apps/api/src');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'safe.ts'),
      [
        'export async function safe(res: { ok: boolean; status: number }) {',
        '  if (!res.ok) {',
        '    await discardUpstreamBody(res);',
        '    throw new Error(`provider failed ${res.status}`);',
        '  }',
        '}',
        '',
      ].join('\n'),
    );
    try {
      expect(scanUpstreamErrorBodies(root)).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('finds no provider-body leak under apps/api/src', () => {
    expect(scanUpstreamErrorBodies(join(import.meta.dirname, '../../../..'))).toEqual([]);
  });
});
