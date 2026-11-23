import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseRut } from './public-sector/rut.js';
import { syntheticRut, syntheticRutBody, SYNTHETIC_RUT_SEED } from './public-sector/synthetic-rut.js';

/**
 * Fails the build when tracked files contain the banned company-email domain,
 * a consumer gmail address, or a checksum-valid Chile RUT outside
 * scripts/synthetic-pii-allowlist.json. Reports path and count only.
 */

interface Allowlist {
  description?: string;
  gmailAddresses: string[];
  mantuPaths: string[];
  rutBodies: number[];
  rutPaths: string[];
}

interface HitCounts {
  mantu: number;
  gmail: number;
  ruts: number;
}

const REWRITTEN = [
  'packages/shared/src/public-sector/__fixtures__/cl/oc-da-2025-7.head.csv',
  'packages/shared/src/public-sector/__fixtures__/cl/lic-da-2025-7.head.csv',
  'packages/shared/src/public-sector/__fixtures__/cl/ocds-tender-3951-19-LE25.json',
  'packages/shared/src/public-sector/__fixtures__/cl/ocds-award-3951-19-LE25.json',
  'packages/shared/src/public-sector/__fixtures__/cl/ocds-award-2741-120-TD25.json',
  'packages/shared/src/public-sector/csv.test.ts',
  'packages/shared/src/public-sector/cl/ocds-api.test.ts',
  'packages/shared/src/public-sector/cl/bulk.test.ts',
  'docs/factory/PUBLIC-SECTOR-INTEL.md',
];

const DOTTED_RUT = /\d{1,2}\.\d{3}\.\d{3}-[\dkK]/gi;
// The hyphen before a ChileCompra type suffix (`-SE25`, `-LR24`, `-PC25`) is not a RUT boundary.
const DASHED_RUT = /(?<!\d)\d{7,8}-[\dkK](?![\w]|-[A-Za-z]{2}\d{2})/gi;
const QUOTED_PLAIN_RUT = /["'](\d{7,8}[\dkK])["']/gi;
/** Built at runtime so this file does not itself contain the banned spellings. */
const BANNED_EMAIL_DOMAIN = '@' + 'mantu.com';
const GMAIL = new RegExp('[a-z0-9._%+-]+@' + 'gmail.com', 'gi');
const MANTU = new RegExp(BANNED_EMAIL_DOMAIN.replace('.', '\\.'), 'gi');

const SKIP_EXT = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.ico',
  '.pdf',
  '.zip',
  '.woff',
  '.woff2',
  '.ttf',
  '.eot',
  '.mp4',
  '.webm',
]);

function repoRoot(): string {
  return execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
}

function loadAllowlist(root: string): Allowlist {
  const raw = JSON.parse(readFileSync(join(root, 'scripts/synthetic-pii-allowlist.json'), 'utf8')) as Allowlist;
  return {
    gmailAddresses: raw.gmailAddresses.map((e) => e.toLowerCase()),
    mantuPaths: raw.mantuPaths,
    rutBodies: raw.rutBodies,
    rutPaths: raw.rutPaths,
  };
}

function trackedFiles(root: string): string[] {
  const out = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' });
  return out.split('\0').filter(Boolean);
}

/**
 * Quote index of each JSON `"id"` string, and the direct `scheme` of its object.
 * A nested scheme does not apply to a parent id. `null` means the object has no scheme.
 */
function directIdSchemes(text: string): Map<number, string | null> {
  const sites = new Map<number, string | null>();
  interface Frame {
    scheme: string | null;
    expectKey: boolean;
    key: string | null;
    ids: number[];
  }
  const stack: Frame[] = [];
  let inString = false;
  let escape = false;
  let stringStart = -1;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i]!;
    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (c === '\\') {
        escape = true;
        continue;
      }
      if (c !== '"') continue;
      inString = false;
      const frame = stack[stack.length - 1];
      const value = text.slice(stringStart + 1, i);
      if (!frame) continue;
      if (frame.expectKey) {
        frame.key = value;
        frame.expectKey = false;
      } else if (frame.key === 'id') {
        frame.ids.push(stringStart);
        frame.key = null;
      } else if (frame.key === 'scheme') {
        frame.scheme = value;
        frame.key = null;
      } else {
        frame.key = null;
      }
      continue;
    }
    if (c === '"') {
      inString = true;
      stringStart = i;
      continue;
    }
    const frame = stack[stack.length - 1];
    if (c === '{') {
      if (frame) frame.key = null;
      stack.push({ scheme: null, expectKey: true, key: null, ids: [] });
    } else if (c === '}') {
      const closed = stack.pop();
      if (!closed) continue;
      for (const quote of closed.ids) sites.set(quote, closed.scheme);
    } else if (c === '[') {
      if (frame) frame.key = null;
    } else if (c === ':') {
      if (frame) frame.expectKey = false;
    } else if (c === ',') {
      if (frame) frame.expectKey = true;
    }
  }
  return sites;
}

export function scanText(text: string, rel: string, allow: Allowlist, plainRuts: boolean): HitCounts {
  const hits: HitCounts = { mantu: 0, gmail: 0, ruts: 0 };
  if (!allow.mantuPaths.includes(rel)) {
    hits.mantu = [...text.matchAll(MANTU)].length;
  }
  const gmailOk = new Set(allow.gmailAddresses);
  for (const match of text.matchAll(GMAIL)) {
    if (!gmailOk.has(match[0].toLowerCase())) hits.gmail += 1;
  }
  if (!allow.rutPaths.includes(rel)) {
    const bodies = new Set(allow.rutBodies);
    const seen = new Set<number>();
    const idSchemes = plainRuts ? directIdSchemes(text) : null;
    const patterns: RegExp[] = [DOTTED_RUT, DASHED_RUT];
    if (plainRuts) patterns.push(QUOTED_PLAIN_RUT);
    for (const re of patterns) {
      for (const match of text.matchAll(re)) {
        const token = match[1] ?? match[0];
        const start = match.index ?? 0;
        if (seen.has(start)) continue;
        seen.add(start);
        const parsed = parseRut(token);
        if (!parsed || bodies.has(parsed.body)) continue;
        // A quoted plain id is a RUT only inside scheme CL-RUT. Item ids and UNSPSC are not.
        if (re === QUOTED_PLAIN_RUT && idSchemes?.has(start) && idSchemes.get(start)?.toUpperCase() !== 'CL-RUT') {
          continue;
        }
        hits.ruts += 1;
      }
    }
  }
  return hits;
}

function scanRepo(root: string, allow: Allowlist): Map<string, HitCounts> {
  const report = new Map<string, HitCounts>();
  for (const rel of trackedFiles(root)) {
    const abs = join(root, rel);
    if (statSync(abs).isDirectory()) continue;
    const ext = rel.includes('.') ? rel.slice(rel.lastIndexOf('.')).toLowerCase() : '';
    if (SKIP_EXT.has(ext)) continue;
    const buf = readFileSync(abs);
    if (buf.includes(0)) continue;
    const text = buf.toString('latin1');
    const plainRuts = !rel.endsWith('.csv');
    const hits = scanText(text, rel, allow, plainRuts);
    if (hits.mantu || hits.gmail || hits.ruts) report.set(rel, hits);
  }
  return report;
}

function formatReport(report: Map<string, HitCounts>): string {
  const lines = ['personal-data guard: path and count only'];
  const keys = [...report.keys()].sort();
  let mantu = 0;
  let gmail = 0;
  let ruts = 0;
  for (const rel of keys) {
    const hit = report.get(rel)!;
    mantu += hit.mantu;
    gmail += hit.gmail;
    ruts += hit.ruts;
    const parts = [
      hit.mantu ? `banned-domain=${hit.mantu}` : '',
      hit.gmail ? `gmail=${hit.gmail}` : '',
      hit.ruts ? `rut=${hit.ruts}` : '',
    ].filter(Boolean);
    lines.push(`${rel}: ${parts.join(' ')}`);
  }
  lines.push(`totals banned-domain=${mantu} gmail=${gmail} rut=${ruts} files=${keys.length}`);
  return lines.join('\n');
}

describe('synthetic RUT generator', () => {
  it(`keeps ${SYNTHETIC_RUT_SEED} bodies in the reserved windows and checksum-valid`, () => {
    const person = syntheticRut(0, 'person');
    const company = syntheticRut(0, 'company');
    const institution = syntheticRut(0, 'institution');
    expect(person.body).toBe(syntheticRutBody(0, 'person'));
    expect(person.body).toBeGreaterThanOrEqual(1_000_000);
    expect(person.body).toBeLessThanOrEqual(1_000_999);
    expect(company.body).toBeGreaterThanOrEqual(50_000_000);
    expect(institution.body).toBeGreaterThanOrEqual(60_000_000);
    expect(institution.body).toBeLessThan(62_000_000);
    expect(parseRut(person.formatted)?.body).toBe(person.body);
    expect(parseRut(company.dashed)?.dv).toBe(company.dv);
    expect(parseRut(institution.plain)?.formatted).toBe(institution.formatted);
  });
});

describe('personal-data guard', () => {
  const empty: Allowlist = { gmailAddresses: [], mantuPaths: [], rutBodies: [], rutPaths: [] };

  it('flags the banned company domain, a consumer gmail address, and a checksum-valid RUT when nothing is allowlisted', () => {
    const sample = ['user@', 'gmail.com', ' ', '@', 'mantu.com', ' ', syntheticRut(3, 'company').formatted].join('');
    const hits = scanText(sample, 'sample.txt', empty, true);
    expect(hits).toEqual({ mantu: 1, gmail: 1, ruts: 1 });
  });

  it('flags a dashed RUT that the dotted pattern cannot see', () => {
    const dashed = syntheticRut(7, 'person').dashed;
    expect(dashed.includes('.')).toBe(false);
    expect(dashed.includes('-')).toBe(true);
    expect(scanText(dashed, 'sample.txt', empty, false).ruts).toBe(1);
  });

  it('flags a quoted plain RUT that the dotted and dashed patterns cannot see', () => {
    const plain = syntheticRut(8, 'company').plain;
    expect(/[-.]/.test(plain)).toBe(false);
    const quoted = `"${plain}"`;
    expect(scanText(quoted, 'sample.txt', empty, true).ruts).toBe(1);
    expect(scanText(plain, 'sample.txt', empty, true).ruts).toBe(0);
  });

  it('does not count ChileCompra codes as RUTs, even when the prefix checksum is valid', () => {
    // The order and plan prefixes validate as person RUTs. The type suffix is not a RUT boundary.
    // Pieces are split so this file does not itself contain those dashed bodies.
    const sample = ['1346283-3-SE25', '100025' + '4-0-SE24', '1383000-1-LR24', '100062' + '6-0-PC25'].join(' ');
    expect(scanText(sample, 'sample.txt', empty, true).ruts).toBe(0);
    expect(scanText(`${sample} ${syntheticRut(7, 'person').dashed}`, 'sample.txt', empty, true).ruts).toBe(1);
  });

  it('counts a quoted plain id only when that object scheme is CL-RUT', () => {
    // UNSPSC and item ids below are checksum-valid as plain RUTs. A nested CL-RUT
    // must not make the parent item id count. Pieces are split so this file does not
    // itself contain those quoted bodies.
    const unspsc = '8110' + '2201';
    const item = '4295' + '3504';
    const otherItem = '14312' + '1011';
    const person = syntheticRut(8, 'company').plain;
    const sample = [
      `{ "scheme": "UNSPSC", "id": "${unspsc}", "uri": "http://api.mercadopublico.cl/APISOCDS/Productos/Categoria/${unspsc}" }`,
      `{ "id": "${item}", "classification": { "id": "80111701", "scheme": "UNSPSC" } }`,
      `{ "id": "${otherItem}" }`,
      `{ "id": "${item}", "identifier": { "id": "${person}", "scheme": "CL-RUT" } }`,
    ].join('\n');
    expect(scanText(sample, 'sample.json', empty, true).ruts).toBe(1);
  });

  it('an empty allowlist fails closed on this tree', () => {
    const report = scanRepo(repoRoot(), empty);
    let gmail = 0;
    let ruts = 0;
    for (const hit of report.values()) {
      gmail += hit.gmail;
      ruts += hit.ruts;
    }
    expect(report.size).toBeGreaterThan(0);
    expect(gmail).toBeGreaterThan(0);
    expect(ruts).toBeGreaterThan(0);
  });

  it('the parent of the cleanup commit fails the guard on seed fixtures', () => {
    // f54ec4d1's parent. A full SHA, because CI checks out one commit and `f54ec4d1^` is not an object there.
    const parent = '40b13242ebf18d715b67bb6133a9774bbd7d0c78';
    const root = repoRoot();
    const spec = `${parent}:packages/db/src/seed-data.ts`;
    const show = () => execFileSync('git', ['show', spec], { cwd: root, encoding: 'utf8' });
    let text: string;
    try {
      text = show();
    } catch {
      execFileSync('git', ['fetch', '--depth', '1', 'origin', parent], { cwd: root, stdio: 'ignore' });
      text = show();
    }
    expect(scanText(text, 'packages/db/src/seed-data.ts', empty, true).mantu).toBeGreaterThan(0);
  });

  it('ignores an allowlisted gmail fixture and a seeded RUT body', () => {
    const rut = syntheticRut(4, 'person');
    const allow: Allowlist = {
      gmailAddresses: ['owner@gmail.com'],
      mantuPaths: [],
      rutBodies: [rut.body],
      rutPaths: [],
    };
    const sample = `owner@gmail.com ${rut.formatted}`;
    expect(scanText(sample, 'sample.txt', allow, true)).toEqual({ mantu: 0, gmail: 0, ruts: 0 });
  });

  it('does not path-allow the fixtures this change rewrote', () => {
    const allow = loadAllowlist(repoRoot());
    expect(REWRITTEN.length).toBeGreaterThanOrEqual(9);
    expect(allow.rutBodies.length).toBeGreaterThan(0);
    expect(allow.gmailAddresses.length).toBeGreaterThan(0);
    expect(allow.mantuPaths).toEqual([]);
    for (const rel of REWRITTEN) expect(allow.rutPaths, rel).not.toContain(rel);
  });

  it('rejects tracked banned-domain hits, consumer gmail addresses, and checksum-valid RUTs outside the allowlist', () => {
    const root = repoRoot();
    const report = scanRepo(root, loadAllowlist(root));
    expect(report.size, formatReport(report)).toBe(0);
  });
});
