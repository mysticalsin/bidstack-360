import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { isServerOnlySpecifier } from './server-only-specifiers';

/**
 * The browser graph starts at the web app, not only at the shared root.
 * A route file can import node:* or a server-only subpath without that
 * import appearing in packages/shared/src/index.ts.
 */
const WEB_SRC = resolve(process.cwd(), 'src');
const REPO = resolve(process.cwd(), '../..');
const SHARED_SRC = resolve(REPO, 'packages/shared/src');

const BROWSER_SHARED: Record<string, string> = {
  '@bidstack/shared': join(SHARED_SRC, 'index.ts'),
  '@bidstack/shared/schemas': join(SHARED_SRC, 'schemas/index.ts'),
  '@bidstack/shared/types': join(SHARED_SRC, 'types/index.ts'),
};

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
    if (
      trimmed.startsWith('//') ||
      trimmed.startsWith('*') ||
      trimmed.startsWith('import type') ||
      trimmed.startsWith('export type')
    ) {
      continue;
    }
    const match = trimmed.match(/from\s+['"]([^'"]+)['"]/) ?? trimmed.match(/^import\s+['"]([^'"]+)['"]/);
    if (match?.[1]) found.push(match[1]);
  }
  return found;
}

function resolveRelative(fromFile: string, spec: string): string | null {
  const base = resolve(dirname(fromFile), spec);
  const stem = base.endsWith('.js') ? base.slice(0, -3) : base;
  const candidates = [`${stem}.ts`, `${stem}.tsx`, join(stem, 'index.ts'), join(stem, 'index.tsx')];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function webSources(): string[] {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.tsx?$/.test(name) || /\.test\.tsx?$/.test(name) || name.endsWith('.d.ts')) continue;
      files.push(full);
    }
  };
  walk(WEB_SRC);
  return files;
}

function resolveSpecifier(fromFile: string, spec: string): string | null {
  if (BROWSER_SHARED[spec]) return BROWSER_SHARED[spec];
  if (spec.startsWith('@/')) return resolveRelative(join(WEB_SRC, 'index.ts'), `./${spec.slice(2)}`);
  if (spec.startsWith('.')) return resolveRelative(fromFile, spec);
  return null;
}

export function violationsInSource(label: string, src: string): string[] {
  const hits: string[] = [];
  for (const spec of specifiers(src)) {
    if (spec.startsWith('node:') || BUILTINS.has(spec) || isServerOnlySpecifier(spec)) {
      hits.push(`${label} → ${spec}`);
    }
  }
  return hits;
}

/** Value imports the browser bundle would follow. */
export function browserGraphViolations(entryFiles: readonly string[]): string[] {
  const seen = new Set<string>();
  const hits: string[] = [];
  const walk = (file: string) => {
    if (seen.has(file) || !existsSync(file)) return;
    seen.add(file);
    const src = readFileSync(file, 'utf8');
    for (const spec of specifiers(src)) {
      if (spec.startsWith('node:') || BUILTINS.has(spec)) {
        hits.push(`${file} → ${spec}`);
        continue;
      }
      if (isServerOnlySpecifier(spec)) {
        hits.push(`${file} → ${spec}`);
        continue;
      }
      const next = resolveSpecifier(file, spec);
      if (next) walk(next);
    }
  };
  for (const file of entryFiles) walk(file);
  return hits;
}

describe('web bundle stays off node built-ins and server-only modules', () => {
  it('reports a web file that imports node:* or a server-only module', () => {
    // WHY: walking only the shared root misses a route that imports node:*
    // or @bidstack/shared/server directly. Type-only imports are erased.
    const src = [
      "import { readFileSync } from 'node:fs';",
      "import { runWithOAuthRefreshLock } from '@bidstack/shared/server';",
      "import type { DirectAgentProviderId } from '@bidstack/shared/llm';",
    ].join('\n');
    expect(violationsInSource('page.tsx', src)).toEqual([
      'page.tsx → node:fs',
      'page.tsx → @bidstack/shared/server',
    ]);
  });

  it('reaches no node built-in and no server-only module from the web app', () => {
    const entries = webSources();
    expect(entries.length).toBeGreaterThan(10);
    expect(entries.some((file) => file.endsWith(`${join('apps', 'web', 'src', 'main.tsx')}`))).toBe(true);
    expect(browserGraphViolations(entries)).toEqual([]);
  });
});
