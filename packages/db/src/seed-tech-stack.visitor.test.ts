import { readFileSync } from 'node:fs';
import path from 'node:path';

import { openTechStackCategories, parseOpenTechSnapshot } from '@bidstack/shared';
import { describe, expect, it } from 'vitest';

import { SAMPLE_TECH_STACK_ACCOUNTS, sampleStackForAccount, sampleTechSnapshot } from './seed-tech-stack.js';

const CHECKED = '2026-11-25T12:00:00.000Z';

function source(rel: string): string {
  return readFileSync(path.resolve(import.meta.dirname, rel), 'utf8');
}

/** Account names in the visitor demo company list. Pfizer is created later. */
function visitorAccountNames(): string[] {
  const file = source('seed-org-data.ts');
  const start = file.indexOf('const COMPANIES');
  const end = file.indexOf('type OppStage');
  const block = file.slice(start, end);
  return [...block.matchAll(/name: '([^']+)'/g)].map((match) => match[1]!);
}

describe('visitor demo technology stack', () => {
  it('hosts a sample stack for every account the public demo creates', () => {
    // WHY: seedOrgData is the workspace a public demo sign-in creates. It writes
    // an enrichment row with empty provider metadata. The account page reads
    // openTechStack from that metadata, so the technology section says
    // "No technology detected yet" until a live scan is approved.
    const names = visitorAccountNames();
    expect(names).toEqual([
      'Siemens',
      'IKEA',
      'Sanofi',
      'HSBC',
      'Stellantis',
      'Spotify',
      'Northwind Pharma',
    ]);
    expect(openTechStackCategories(parseOpenTechSnapshot({}))).toEqual([]);
    expect(openTechStackCategories(null)).toEqual([]);

    for (const name of names) {
      expect(SAMPLE_TECH_STACK_ACCOUNTS, name).toContain(name);
      const stack = sampleStackForAccount(name);
      expect(stack, name).toBeTruthy();
      const snapshot = sampleTechSnapshot(stack!, CHECKED);
      const items = openTechStackCategories(snapshot).flatMap((category) => category.items);
      expect(snapshot.sample, name).toBe(true);
      expect(items.length, name).toBeGreaterThan(0);
      expect(items.every((item) => item.sample === true), name).toBe(true);
      expect(snapshot.items.every((item) => item.evidence.url === null), name).toBe(true);
      expect(snapshot.items.every((item) => item.evidence.record.startsWith('Sample')), name).toBe(true);
      expect(snapshot.items.every((item) => item.source.startsWith('open_data:')), name).toBe(true);
    }
  });

  it('writes the sample stack from both demo doors, after the accounts exist', () => {
    // WHY: the public sign-in and `db:seed:demo` both call seedOrgData and never
    // reach the dev fixture seed that already writes stacks for DNB and CI Financial.
    // A stack written before the companies exist is skipped.
    const door = source('../../../apps/api/src/plugins/demo-auth.ts');
    const tx = door.indexOf('prisma.$transaction');
    const seeded = door.indexOf('await seedOrgData(');
    const tech = door.indexOf('await seedTechStacks(');
    const timeout = door.indexOf('timeout:');
    expect(tx).toBeGreaterThan(0);
    expect(seeded).toBeGreaterThan(tx);
    expect(tech).toBeGreaterThan(seeded);
    expect(timeout).toBeGreaterThan(tech);

    const cli = source('seed-demo.ts');
    const cliSeed = cli.indexOf('await seedOrgData(');
    const cliTech = cli.indexOf('await seedTechStacks(');
    expect(cliSeed).toBeGreaterThan(0);
    expect(cliTech).toBeGreaterThan(cliSeed);
  });
});
