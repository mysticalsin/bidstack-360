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
  'packages/shared/src/public-sector/csv.test.ts',
  'packages/shared/src/public-sector/cl/ocds-api.test.ts',
  'packages/shared/src/public-sector/cl/bulk.test.ts',
  'docs/factory/PUBLIC-SECTOR-INTEL.md',
];

const DOTTED_RUT = /\d{1,2}\.\d{3}\.\d{3}-[\dkK]/gi;
const DASHED_RUT = /(?<!\d)\d{7,8}-[\dkK](?![\w])/gi;
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
    const patterns: RegExp[] = [DOTTED_RUT, DASHED_RUT];
    if (plainRuts) patterns.push(QUOTED_PLAIN_RUT);
    for (const re of patterns) {
      for (const match of text.matchAll(re)) {
        const token = match[1] ?? match[0];
        const start = match.index ?? 0;
        if (seen.has(start)) continue;
        seen.add(start);
        const parsed = parseRut(token);
        if (parsed && !bodies.has(parsed.body)) hits.ruts += 1;
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
    expect(allow.mantuPaths).toEqual([]);
    for (const rel of REWRITTEN) expect(allow.rutPaths, rel).not.toContain(rel);
  });

  it('rejects tracked banned-domain hits, consumer gmail addresses, and checksum-valid RUTs outside the allowlist', () => {
    const root = repoRoot();
    const report = scanRepo(root, loadAllowlist(root));
    expect(report.size, formatReport(report)).toBe(0);
  });
});
