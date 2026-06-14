// i18n coverage tracker for the string-externalization program.
//
// Measures how much of the web UI is wired to react-i18next vs still hardcoded,
// so the full-app externalization sweep is trackable per pass. Heuristic, not a
// compiler: a file "counts as localized" if it imports useTranslation / Trans.
// Run: npx tsx apps/web/scripts/i18n-coverage.mts   (optionally a path prefix arg)
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', 'src');
const FILTER = process.argv[2] ?? '';

const SKIP_DIRS = new Set(['__tests__', 'node_modules']);
const isLocalizable = (f) => /\.(tsx)$/.test(f) && !/\.(test|spec|stories)\.tsx$/.test(f);

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(path.join(dir, entry.name), out);
    } else if (isLocalizable(entry.name)) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

const files = walk(ROOT)
  .map((f) => path.relative(ROOT, f).replace(/\\/g, '/'))
  .filter((f) => f.includes(FILTER));

let localized = 0;
const uncovered = [];
for (const rel of files) {
  const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const usesI18n = /useTranslation|\bTrans\b|i18n\.t\(/.test(src);
  if (usesI18n) localized += 1;
  else uncovered.push({ rel, lines: src.split('\n').length });
}

const pct = files.length ? ((localized / files.length) * 100).toFixed(1) : '0.0';
console.log(`\ni18n coverage${FILTER ? ` (filter: ${FILTER})` : ''}`);
console.log(`  localized: ${localized}/${files.length}  (${pct}%)`);
console.log(`  uncovered: ${uncovered.length}`);
console.log(`\nTop uncovered by size (externalize these first):`);
for (const u of uncovered.sort((a, b) => b.lines - a.lines).slice(0, 20)) {
  console.log(`  ${String(u.lines).padStart(4)}  ${u.rel}`);
}
