/**
 * Turn raw Chile recordings into committed fixtures (spec 8b.0).
 *
 * Usage: pnpm exec tsx packages/shared/scripts/scrub-cl-fixtures.ts <rawDir>
 *
 * <rawDir> holds unmodified public responses recorded without a ticket:
 *   ocds-list.json, ocds-list-td.json, tender-<code>.json, award-<code>.json,
 *   ticket-invalid.json (the HTTP 203 body), lic-da-2025-7.head.csv,
 *   oc-da-2025-7.head.csv (cut at record boundaries), erroneas.csv.
 * Raw recordings stay outside the repo. Output is written to
 * src/public-sector/__fixtures__/cl/ and must pass findPersonalData().
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { findPersonalData, scrubBulkCsvText, scrubOcdsPackage, scrubText } from '../src/public-sector/scrub.js';

const rawDir = process.argv[2];
if (!rawDir) throw new Error('usage: scrub-cl-fixtures.ts <rawDir>');
const out = fileURLToPath(new URL('../src/public-sector/__fixtures__/cl/', import.meta.url));

function writeChecked(name: string, data: Buffer | string, text: string): void {
  const hits = findPersonalData(text);
  if (hits.length > 0) throw new Error(`${name}: ${hits.length} personal data hits remain`);
  writeFileSync(join(out, name), data);
  process.stdout.write(`wrote ${name}\n`);
}

function json(name: string, target: string, transform: (v: unknown) => unknown): void {
  const value = transform(JSON.parse(readFileSync(join(rawDir!, name), 'utf8')));
  const text = `${JSON.stringify(value, null, 2)}\n`;
  writeChecked(target, text, text);
}

const listOnly = (v: unknown) => JSON.parse(scrubText(JSON.stringify(v)));

json('ocds-list.json', 'ocds-list-2025-07.json', listOnly);
json('ocds-list-td.json', 'ocds-list-trato-directo-2025-07.json', listOnly);
json('tender-3951-19-LE25.json', 'ocds-tender-3951-19-LE25.json', scrubOcdsPackage);
json('award-3951-19-LE25.json', 'ocds-award-3951-19-LE25.json', scrubOcdsPackage);
json('award-2741-120-TD25.json', 'ocds-award-2741-120-TD25.json', scrubOcdsPackage);
json('ticket-invalid.json', 'mp-api-ticket-invalid.json', (v) => v);

for (const [name, kind] of [
  ['lic-da-2025-7.head.csv', 'lic'],
  ['oc-da-2025-7.head.csv', 'oc'],
] as const) {
  const text = scrubBulkCsvText(readFileSync(join(rawDir, name)).toString('latin1'), kind);
  writeChecked(name, Buffer.from(text, 'latin1'), text);
}

const erroneous = readFileSync(join(rawDir, 'erroneas.csv')).toString('latin1').split('\n');
const wanted = ['4707-257-SE25', '2177-68-SE25', '3630-198-TD25', '3833-520-SE25'];
const subset = [
  erroneous[0]!,
  ...erroneous.slice(1, 37),
  ...erroneous.filter((line) => wanted.some((code) => line.includes(`"${code}"`))),
].join('\n');
writeChecked('hist_OC_erroneas.head.csv', Buffer.from(`${subset}\n`, 'latin1'), subset);
