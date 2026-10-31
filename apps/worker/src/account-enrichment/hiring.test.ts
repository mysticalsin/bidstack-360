import { describe, expect, it } from 'vitest';

import {
  buildHiringBreakdown,
  classifyPosting,
  classifyTitle,
  confidenceFor,
  inferPotentialProjects,
  type PostingInput,
  regionFor,
} from './hiring.js';
import { relabelProjects } from './projects-llm.js';

const NOW = new Date('2026-10-31T12:00:00Z');
let seq = 0;
function post(title: string, country: string | null, extra: Partial<PostingInput> = {}): PostingInput {
  seq += 1;
  return { id: `p${seq}`, source: 'apollo', title, url: `https://jobs.example.com/${seq}`, city: null, state: null, country, postedAt: '2026-10-20T00:00:00Z', ...extra };
}

describe('classifyTitle', () => {
  it.each([
    ['Senior Data Engineer', 'data', 'senior', []],
    ['Snowflake Architect', 'data', 'principal', ['Snowflake']],
    ['Machine Learning Engineer (LLM)', 'ml_ai', 'mid', ['LLM']],
    ['Head of Security Operations', 'security', 'director', []],
    ['DevOps Engineer - AWS / Terraform', 'infrastructure', 'mid', ['AWS', 'Terraform']],
    ['SAP S/4HANA Finance Consultant', 'finance', 'mid', ['SAP', 'S/4HANA']],
    ['Salesforce Developer', 'engineering', 'mid', ['Salesforce']],
    ['Account Executive, Enterprise', 'sales', 'mid', []],
    ['Solutions Engineer', 'sales', 'mid', []],
    ['Customer Success Manager', 'customer_success', 'manager', []],
    ['VP Marketing', 'marketing', 'vp', []],
    ['Chief Technology Officer', 'engineering', 'c_level', []],
    ['Product Designer', 'design', 'mid', []],
    ['Junior Accountant', 'finance', 'junior', []],
    ['Barista', 'other', 'mid', []],
  ])('%s', (title, fn, seniority, skills) => {
    const c = classifyTitle(title);
    expect(c.function).toBe(fn);
    expect(c.seniority).toBe(seniority);
    expect(c.skills).toEqual(skills);
  });

  it('flags architects', () => {
    expect(classifyTitle('Cloud Solutions Architect').architect).toBe(true);
    expect(classifyTitle('Data Engineer').architect).toBe(false);
  });
});

describe('regionFor', () => {
  it('maps countries and ISO codes', () => {
    expect(regionFor('United Kingdom')).toBe('EMEA');
    expect(regionFor('DE')).toBe('EMEA');
    expect(regionFor('United States')).toBe('AMER');
    expect(regionFor(null, 'TX')).toBe('AMER');
    expect(regionFor('Brazil')).toBe('LATAM');
    expect(regionFor('India')).toBe('APAC');
    expect(regionFor('Atlantis')).toBe('unknown');
    expect(regionFor(null)).toBe('unknown');
  });
});

describe('inferPotentialProjects', () => {
  it("reads 12 data engineers plus a Snowflake architect in EMEA as a data platform migration (Tony's example)", () => {
    const postings = [
      ...Array.from({ length: 12 }, (_, i) => post(i % 3 === 0 ? 'Senior Data Engineer' : 'Data Engineer', ['United Kingdom', 'Germany', 'France'][i % 3]!)),
      post('Snowflake Architect', 'Netherlands'),
      post('Account Executive', 'United States'),
    ].map(classifyPosting);
    const projects = inferPotentialProjects(postings, NOW);
    const data = projects.find((p) => p.kind === 'data_platform')!;
    expect(data).toMatchObject({
      id: 'data_platform:EMEA',
      name: 'Data platform migration to Snowflake in EMEA',
      confidence: 'high',
      region: 'EMEA',
      postingCount: 13,
      method: 'rules',
    });
    expect(data.seniorCount).toBe(5);
    expect(data.evidence[0]).toMatchObject({ title: 'Snowflake Architect', seniority: 'principal', source: 'apollo' });
    expect(data.evidence).toHaveLength(10);
    expect(data.evidence.every((e) => e.url?.startsWith('https://'))).toBe(true);
    expect(data.rationale).toBe(
      '13 open data engineering and analytics roles in EMEA, 5 of them senior, including Snowflake Architect. Skills named in the titles: Snowflake.',
    );
    expect(data.rationale).not.toMatch(/[\u2014]/);
    expect(projects.some((p) => p.kind === 'gtm_expansion')).toBe(false);
  });

  it('confidence tiers: low at the minimum, medium at +2, high needs volume and a senior anchor', () => {
    const mk = (n: number, title = 'Data Engineer') => Array.from({ length: n }, () => classifyPosting(post(title, 'France')));
    expect(confidenceFor(mk(2), 3, NOW)).toBeNull();
    expect(confidenceFor(mk(3), 3, NOW)).toBe('low');
    expect(confidenceFor(mk(5), 3, NOW)).toBe('medium');
    expect(confidenceFor(mk(12), 3, NOW)).toBe('medium');
    expect(confidenceFor([...mk(11), ...mk(1, 'Lead Data Engineer')], 3, NOW)).toBe('high');
    const stale = [...mk(11), ...mk(1, 'Lead Data Engineer')].map((p) => ({ ...p, postedAt: '2026-06-01T00:00:00Z' }));
    expect(confidenceFor(stale, 3, NOW)).toBe('medium');
  });

  it('pools small or unstated regions into Multi-region', () => {
    const postings = [post('Security Engineer', 'France'), post('SOC Analyst', 'India'), post('Security Analyst', null)].map(classifyPosting);
    const projects = inferPotentialProjects(postings, NOW);
    expect(projects.map((p) => [p.id, p.name, p.confidence])).toEqual([
      ['security:Multi-region', 'Security programme across regions', 'low'],
    ]);
  });

  it('names ERP, CRM, cloud and GTM projects and orders by confidence', () => {
    const postings = [
      ...Array.from({ length: 4 }, () => post('SAP S/4HANA Consultant', 'Germany')),
      ...Array.from({ length: 3 }, () => post('Salesforce Administrator', 'United States')),
      ...Array.from({ length: 6 }, () => post('Account Executive', 'Brazil')),
      ...Array.from({ length: 3 }, () => post('Azure Cloud Engineer', 'India')),
    ].map(classifyPosting);
    const projects = inferPotentialProjects(postings, NOW);
    expect(projects.map((p) => [p.name, p.confidence, p.postingCount])).toEqual([
      ['Go-to-market expansion in LATAM', 'low', 6],
      ['SAP S/4HANA transformation in EMEA', 'low', 4],
      ['Cloud migration to Azure in APAC', 'low', 3],
      ['Salesforce roll-out in AMER', 'low', 3],
    ]);
  });

  it('returns nothing without enough signal', () => {
    expect(inferPotentialProjects([post('Barista', 'France'), post('Data Engineer', 'France')].map(classifyPosting), NOW)).toEqual([]);
    expect(inferPotentialProjects([], NOW)).toEqual([]);
  });
});

describe('buildHiringBreakdown', () => {
  it('counts by function, seniority, region and skills, and clusters function x region', () => {
    const postings = [post('Senior Data Engineer', 'France'), post('Data Engineer (Snowflake)', 'France'), post('Account Executive', 'United States')].map(classifyPosting);
    const b = buildHiringBreakdown(postings);
    expect(b.total).toBe(3);
    expect(b.byFunction).toEqual([{ key: 'data', count: 2 }, { key: 'sales', count: 1 }]);
    expect(b.byRegion).toEqual([{ key: 'EMEA', count: 2 }, { key: 'AMER', count: 1 }]);
    expect(b.topSkills).toEqual([{ key: 'Snowflake', count: 1 }]);
    expect(b.clusters[0]).toMatchObject({ function: 'data', region: 'EMEA', count: 2, topSkills: ['Snowflake'] });
    expect(b.clusters[0]!.seniority).toEqual([{ key: 'mid', count: 1 }, { key: 'senior', count: 1 }]);
  });
});

describe('relabelProjects', () => {
  const base = inferPotentialProjects(Array.from({ length: 5 }, () => classifyPosting(post('Data Engineer', 'France'))), NOW);

  it('keeps rule output when no LLM is configured or it fails', async () => {
    expect(await relabelProjects(base, null)).toEqual(base);
    expect(await relabelProjects(base, async () => { throw new Error('down'); })).toEqual(base);
    expect(await relabelProjects(base, async () => 'not json')).toEqual(base);
  });

  it('rewrites only name and rationale for known ids, strips em dashes, ignores invented projects', async () => {
    const out = await relabelProjects(base, async () =>
      JSON.stringify({
        projects: [
          { id: base[0]!.id, name: 'Lakehouse build \u2014 France', rationale: 'Five data engineers in France point to a new data platform.', confidence: 'high' },
          { id: 'invented:EMEA', name: 'Made up', rationale: 'x' },
        ],
      }),
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: base[0]!.id, name: 'Lakehouse build, France', method: 'rules+llm', confidence: base[0]!.confidence });
    expect(out[0]!.evidence).toEqual(base[0]!.evidence);
  });
});
