import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { sampleInfoSearchLeads } from './infosearch-client.js';
import { sampleLmsCourses } from './lms-360learning.js';
import {
  firmographicsForMode,
  infoSearchForMode,
  lmsForMode,
  pipelineForMode,
} from './sample-reads.js';

const REPO = join(import.meta.dirname, '../../../..');

/** Sample modules the inventory must name. A new sample.ts fails until it is listed. */
const REGISTERED_SAMPLE_FILES = [
  'apps/web/src/lib/orgchart/sample.ts',
  'apps/web/src/lib/msa/sample.ts',
  'apps/api/src/lib/infosearch-client.ts',
  'apps/api/src/lib/lms-360learning.ts',
  'apps/web/src/lib/enrichment/mock.ts',
  'packages/shared/src/schemas/account-financials.ts',
];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name === 'generated') continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (name === 'sample.ts') out.push(path.slice(REPO.length + 1));
  }
  return out;
}

describe('sample inventory', () => {
  it('names every sample.ts module', () => {
    const found = [...walk(join(REPO, 'apps')), ...walk(join(REPO, 'packages'))].sort();
    const registered = REGISTERED_SAMPLE_FILES.filter((file) => file.endsWith('/sample.ts')).sort();
    expect(found).toEqual(registered);
  });

  it('real mode does not return sample InfoSearch leads', () => {
    const real = infoSearchForMode('real', 'Acme');
    expect(real.preview).toBe(false);
    expect(real.items).toEqual([]);
    expect(JSON.stringify(real)).not.toContain('Jordan Avery');
    const demo = infoSearchForMode('demo', 'Acme');
    expect(demo.preview).toBe(true);
    expect(demo.items.map((item) => item.name)).toEqual(sampleInfoSearchLeads('Acme').map((item) => item.name));
  });

  it('real mode does not return sample LMS courses', () => {
    const real = lmsForMode('real');
    expect(real.preview).toBe(false);
    expect(real.items).toEqual([]);
    expect(JSON.stringify(real)).not.toContain('Winning Financial Services Bids');
    expect(lmsForMode('demo').items.length).toBe(sampleLmsCourses().length);
  });

  it('real mode hides fixture firmographics and keeps the stored row', () => {
    const stored = {
      companyId: 'co-1',
      status: 'ok',
      annualRevenueUsd: 2_900_000_000,
      employeeCount: 2600,
      provenance: { annualRevenueUsd: { source: 'fixture', fetchedAt: '2026-01-01' } },
    };
    const real = firmographicsForMode('real', stored);
    expect(real.status).toBe('not_connected');
    expect(real.annualRevenueUsd).toBeNull();
    expect(real.employeeCount).toBeNull();
    expect(real.provenance).toEqual(stored.provenance);
    expect(firmographicsForMode('demo', stored)).toEqual(stored);
  });

  it('real mode drops fixture pipeline rows and does not delete them from the input', () => {
    const stored = [
      { code: 'OP-1', provenance: 'fixture', valueMicros: 11_890_000 },
      { code: 'OP-2', provenance: 'manual', valueMicros: 10 },
    ];
    const real = pipelineForMode('real', stored);
    expect(real.map((row) => row.code)).toEqual(['OP-2']);
    expect(stored).toHaveLength(2);
    expect(pipelineForMode('demo', stored)).toEqual(stored);
  });
});
