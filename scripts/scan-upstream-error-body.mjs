import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const SOURCE_RE = /\.ts$/u;
const TEST_RE = /\.(?:test|spec)\.ts$/u;

/**
 * A not-ok branch that reads the provider body and puts that text into a
 * thrown Error or a log call. Status-only throws are allowed.
 */
export function scanUpstreamErrorBodies(rootDir, scanRoot = 'apps/api/src') {
  const failures = [];
  for (const file of collectSources(join(rootDir, scanRoot))) {
    const text = readFileSync(file, 'utf8');
    for (const block of notOkBlocks(text)) {
      if (!leaksBody(block.body, block.name)) continue;
      const line = text.slice(0, block.index).split(/\r?\n/u).length;
      failures.push({
        file: relative(rootDir, file).replaceAll('\\', '/'),
        line,
        message: `!${block.name}.ok reads the body into a throw or a log`,
      });
    }
  }
  return failures;
}

function collectSources(dir, out = []) {
  let entries = [];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      collectSources(path, out);
    } else if (entry.isFile() && SOURCE_RE.test(entry.name) && !TEST_RE.test(entry.name)) {
      out.push(path);
    }
  }
  return out;
}

function notOkBlocks(source) {
  const re = /if\s*\(\s*!\s*([A-Za-z_$][\w$]*)\.ok\s*\)\s*\{/gu;
  const blocks = [];
  for (const match of source.matchAll(re)) {
    const open = match.index + match[0].length - 1;
    let depth = 0;
    let end = open;
    for (let i = open; i < source.length; i += 1) {
      if (source[i] === '{') depth += 1;
      else if (source[i] === '}') {
        depth -= 1;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    blocks.push({
      name: match[1],
      index: match.index,
      body: source.slice(open + 1, end),
    });
  }
  return blocks;
}

function leaksBody(body, name) {
  const reads = [
    ...body.matchAll(
      new RegExp(
        `(?:const|let)\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*await\\s+${name}\\.(?:text|json)\\s*\\(`,
        'gu',
      ),
    ),
  ].map((match) => match[1]);
  const sinks = body.match(/throw\s+new\s+Error\s*\(|\blog\.\w+\s*\(/u);
  if (!sinks) return false;
  for (const variable of reads) {
    if (body.includes(`\${${variable}}`) || body.includes(`\${${variable}.`)) return true;
  }
  return new RegExp(
    `(?:throw\\s+new\\s+Error|log\\.\\w+)\\s*\\([^)]*${name}\\.(?:text|json)\\s*\\(`,
    'u',
  ).test(body);
}
