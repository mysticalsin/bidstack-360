import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * The web bundle imports `@bidstack/shared` (the root entry). A node built-in
 * on that graph is externalized by Vite and the SPA fails to load. Server-only
 * modules belong on `@bidstack/shared/server`, not this entry.
 */
const ROOT_ENTRY = resolve(process.cwd(), '../../packages/shared/src/index.ts');

const BUILTINS = new Set([
  'assert',
  'async_hooks',
  'buffer',
  'child_process',
  'cluster',
  'console',
  'constants',
  'crypto',
  'dgram',
  'dns',
  'events',
  'fs',
  'http',
  'http2',
  'https',
  'inspector',
  'module',
  'net',
  'os',
  'path',
  'perf_hooks',
  'process',
  'punycode',
  'querystring',
  'readline',
  'stream',
  'string_decoder',
  'timers',
  'tls',
  'tty',
  'url',
  'util',
  'v8',
  'vm',
  'wasi',
  'worker_threads',
  'zlib',
]);

function specifiers(src: string): string[] {
  const found: string[] = [];
  for (const line of src.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('import type')) {
      continue;
    }
    const match = trimmed.match(/from\s+['"]([^'"]+)['"]/) ?? trimmed.match(/^import\s+['"]([^'"]+)['"]/);
    if (match?.[1]) found.push(match[1]);
  }
  return found;
}

function resolveRelative(fromFile: string, spec: string): string | null {
  const base = resolve(dirname(fromFile), spec);
  const candidates = [
    base.endsWith('.js') ? base.replace(/\.js$/, '.ts') : base,
    base.endsWith('.js') ? base.replace(/\.js$/, '.tsx') : `${base}.ts`,
    join(base.endsWith('.js') ? base.slice(0, -3) : base, 'index.ts'),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function nodeBuiltinsInBrowserEntry(): string[] {
  const seen = new Set<string>();
  const hits: string[] = [];
  const walk = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    const src = readFileSync(file, 'utf8');
    for (const spec of specifiers(src)) {
      if (spec.startsWith('node:') || BUILTINS.has(spec)) {
        hits.push(`${file} → ${spec}`);
        continue;
      }
      if (!spec.startsWith('.')) continue;
      const next = resolveRelative(file, spec);
      if (next) walk(next);
    }
  };
  walk(ROOT_ENTRY);
  return hits;
}

describe('shared root entry stays browser-safe', () => {
  it('reaches no node built-in from the package root', () => {
    expect(nodeBuiltinsInBrowserEntry()).toEqual([]);
  });
});
