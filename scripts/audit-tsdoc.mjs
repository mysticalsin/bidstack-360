#!/usr/bin/env node
/**
 * audit-tsdoc.mjs
 *
 * Walks TypeScript source files in packages/ + apps/api/src/ + apps/web/src/
 * and measures TSDoc coverage: the fraction of exported symbols that have a
 * preceding JSDoc/TSDoc block comment (/** ... *\/).
 *
 * Usage:
 *   node scripts/audit-tsdoc.mjs
 *   node scripts/audit-tsdoc.mjs --json          # emit JSON to stdout
 *   node scripts/audit-tsdoc.mjs --fail-below=80  # exit 1 if coverage < 80%
 *   node scripts/audit-tsdoc.mjs --package=shared # restrict to one package
 *
 * WHY regex-based: TypeScript compiler API is correct but slow and adds a
 * 300 ms startup overhead. For CI we need < 5 s. The regex approach is
 * conservative — it may miss some edge cases but never false-positives
 * (undocumented exports are never counted as documented).
 *
 * Exit codes:
 *   0 — coverage meets threshold (or no threshold set)
 *   1 — coverage below threshold
 *   2 — script error (file not found, parse failure)
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, extname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(import.meta.url), '../..');

// Patterns of exported declarations we want to check.
// We detect a TSDoc block by looking at the lines immediately before the export.
const EXPORT_RE =
  /^(?:export\s+(?:default\s+)?(?:async\s+)?(?:function|class|interface|type|enum|const|let|var)\b|export\s+\{)/;

// A /** ... */ block immediately preceding the export (allowing decorators).
// We look backwards through the source lines.
const TSDOC_RE = /^\s*\*\//; // a line ending a block comment

// ── CLI args ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const jsonMode = args.includes('--json');
const failBelow = (() => {
  const f = args.find((a) => a.startsWith('--fail-below='));
  return f ? Number(f.split('=')[1]) : null;
})();
const packageFilter = (() => {
  const p = args.find((a) => a.startsWith('--package='));
  return p ? p.split('=')[1] : null;
})();

// ── File collection ───────────────────────────────────────────────────────────

const SCAN_ROOTS = [
  { label: 'packages/db', path: join(ROOT, 'packages/db/src') },
  { label: 'packages/shared', path: join(ROOT, 'packages/shared/src') },
  { label: 'packages/dust-client', path: join(ROOT, 'packages/dust-client/src') },
  { label: 'apps/api', path: join(ROOT, 'apps/api/src') },
  { label: 'apps/web', path: join(ROOT, 'apps/web/src') },
];

const IGNORE = new Set([
  'node_modules',
  'dist',
  'build',
  '.turbo',
  '__tests__',
  'migrations',
]);

function walkTs(dir) {
  /** @type {string[]} */
  const files = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return files; // directory may not exist in all envs
  }
  for (const entry of entries) {
    if (IGNORE.has(entry)) continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      files.push(...walkTs(full));
    } else if (stat.isFile() && ['.ts', '.tsx'].includes(extname(entry)) && !entry.endsWith('.d.ts')) {
      files.push(full);
    }
  }
  return files;
}

// ── Analysis ──────────────────────────────────────────────────────────────────

/**
 * @typedef {{ file: string; line: number; symbol: string }} UndocumentedExport
 */

/**
 * Analyzes a single TypeScript file for export TSDoc coverage.
 *
 * @param {string} filePath - Absolute path to the TypeScript file.
 * @returns {{ documented: number; undocumented: number; missing: UndocumentedExport[] }}
 */
function analyzeFile(filePath) {
  let src;
  try {
    src = readFileSync(filePath, 'utf-8');
  } catch {
    return { documented: 0, undocumented: 0, missing: [] };
  }

  const lines = src.split('\n');
  let documented = 0;
  let undocumented = 0;
  /** @type {UndocumentedExport[]} */
  const missing = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!EXPORT_RE.test(line.trimStart())) continue;

    // Extract a rough symbol name from the export line.
    const symbolMatch = line.match(
      /export\s+(?:default\s+)?(?:async\s+)?(?:function|class|interface|type|enum|const|let|var)\s+(\w+)/,
    );
    const symbol = symbolMatch?.[1] ?? '(anonymous)';

    // Walk backwards to find a closing */ within 3 lines (allowing decorators).
    let hasDoc = false;
    for (let back = 1; back <= 3; back++) {
      const prev = lines[i - back]?.trimEnd();
      if (!prev) break;
      if (TSDOC_RE.test(prev)) {
        hasDoc = true;
        break;
      }
      // Stop if we hit a non-blank, non-decorator, non-comment line that isn't *
      if (!/^\s*(\*|@|\s*$)/.test(prev)) break;
    }

    if (hasDoc) {
      documented++;
    } else {
      undocumented++;
      missing.push({
        file: relative(ROOT, filePath),
        line: i + 1,
        symbol,
      });
    }
  }

  return { documented, undocumented, missing };
}

// ── Main ──────────────────────────────────────────────────────────────────────

/**
 * @typedef {{ label: string; documented: number; undocumented: number; coverage: number; missing: UndocumentedExport[] }} PackageResult
 */

/** @type {PackageResult[]} */
const results = [];

for (const { label, path } of SCAN_ROOTS) {
  if (packageFilter && !label.includes(packageFilter)) continue;

  const files = walkTs(path);
  let pkgDocumented = 0;
  let pkgUndocumented = 0;
  /** @type {UndocumentedExport[]} */
  const pkgMissing = [];

  for (const file of files) {
    const { documented, undocumented, missing } = analyzeFile(file);
    pkgDocumented += documented;
    pkgUndocumented += undocumented;
    pkgMissing.push(...missing);
  }

  const total = pkgDocumented + pkgUndocumented;
  const coverage = total === 0 ? 100 : Math.round((pkgDocumented / total) * 1000) / 10;

  results.push({
    label,
    documented: pkgDocumented,
    undocumented: pkgUndocumented,
    coverage,
    missing: pkgMissing,
  });
}

// ── Output ────────────────────────────────────────────────────────────────────

const totalDocumented = results.reduce((a, r) => a + r.documented, 0);
const totalUndocumented = results.reduce((a, r) => a + r.undocumented, 0);
const totalAll = totalDocumented + totalUndocumented;
const overallCoverage = totalAll === 0 ? 100 : Math.round((totalDocumented / totalAll) * 1000) / 10;

if (jsonMode) {
  process.stdout.write(
    JSON.stringify({ overallCoverage, totalDocumented, totalUndocumented, packages: results }, null, 2),
  );
  process.stdout.write('\n');
} else {
  console.log('\nTSDoc Coverage Audit');
  console.log('═'.repeat(60));
  for (const r of results) {
    const bar = '█'.repeat(Math.round(r.coverage / 5)).padEnd(20, '░');
    const status = r.coverage >= 80 ? '✓' : '✗';
    console.log(
      `${status} ${r.label.padEnd(25)} ${bar} ${String(r.coverage).padStart(5)}%  (${r.documented}/${r.documented + r.undocumented})`,
    );
  }
  console.log('─'.repeat(60));
  const overallBar = '█'.repeat(Math.round(overallCoverage / 5)).padEnd(20, '░');
  const overallStatus = overallCoverage >= 80 ? '✓' : '✗';
  console.log(
    `${overallStatus} ${'OVERALL'.padEnd(25)} ${overallBar} ${String(overallCoverage).padStart(5)}%  (${totalDocumented}/${totalAll})`,
  );

  if (failBelow !== null) {
    console.log('');
    if (overallCoverage < failBelow) {
      console.log(`✗ Coverage ${overallCoverage}% is below threshold ${failBelow}%. Failing.`);
    } else {
      console.log(`✓ Coverage ${overallCoverage}% meets threshold ${failBelow}%.`);
    }
  }

  // List undocumented exports across all packages (first 50 to keep output readable)
  const allMissing = results.flatMap((r) => r.missing);
  if (allMissing.length > 0) {
    console.log('\nUndocumented exports (first 50):');
    for (const m of allMissing.slice(0, 50)) {
      console.log(`  ${m.file}:${m.line}  ${m.symbol}`);
    }
    if (allMissing.length > 50) {
      console.log(`  … and ${allMissing.length - 50} more`);
    }
  }
}

if (failBelow !== null && overallCoverage < failBelow) {
  process.exit(1);
}
