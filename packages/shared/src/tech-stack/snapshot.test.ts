import { describe, expect, it } from 'vitest';

import type { OpenTechDetection } from './lanes.js';
import {
  coverageFromSnapshot,
  mergeOpenTechSnapshot,
  needsApolloFallback,
  openTechStackCategories,
  parseOpenTechSnapshot,
  techSourceLabel,
  type OpenTechStackSnapshot,
} from './snapshot.js';

const OLD = '2026-10-01T00:00:00.000Z';
const NOW = '2026-11-07T12:00:00.000Z';

function det(name: string, lane: OpenTechDetection['lane'], confidence: number, category: OpenTechDetection['category'] = 'Cloud', observedAt = NOW): OpenTechDetection {
  return { name, category, lane, source: `open_data:${lane}`, confidence, evidence: { url: null, record: `${lane} saw ${name}`, observedAt } };
}

const lane = (l: OpenTechDetection['lane'], status: 'found' | 'empty' | 'failed' | 'skipped', checkedAt: string | null = NOW) => ({ lane: l, status, count: 0, detail: status === 'failed' ? 'boom' : null, checkedAt });

describe('open tech snapshot merge', () => {
  const prev = mergeOpenTechSnapshot(null, {
    checkedAt: OLD,
    items: [det('Okta', 'ct', 0.8, 'Identity', OLD), det('Microsoft 365', 'dns', 0.95, 'Collaboration', OLD), det('HubSpot', 'web', 0.9, 'Marketing', OLD)],
    lanes: [lane('dns', 'found', OLD), lane('ct', 'found', OLD), lane('web', 'found', OLD)],
  });

  it('keeps items of a lane that failed and replaces lanes that ran', () => {
    const next = mergeOpenTechSnapshot(prev, {
      checkedAt: NOW,
      items: [det('Google Workspace', 'dns', 0.95, 'Collaboration')],
      lanes: [lane('dns', 'found'), lane('ct', 'failed'), lane('web', 'empty'), lane('jobs', 'empty'), lane('github', 'skipped', null)],
    });
    expect(next.items.map((i) => i.name).sort()).toEqual(['Google Workspace', 'Okta']);
    expect(next.items.find((i) => i.name === 'Okta')!.evidence.observedAt).toBe(OLD);
    expect(next.lanes.map((l) => [l.lane, l.status, l.count])).toEqual([
      ['dns', 'found', 1],
      ['ct', 'failed', 1],
      ['web', 'empty', 0],
      ['jobs', 'empty', 0],
      ['github', 'skipped', 0],
    ]);
    expect(parseOpenTechSnapshot(JSON.parse(JSON.stringify(next)))).toEqual(next);
  });

  it('keeps the lanes the run did not report', () => {
    const next = mergeOpenTechSnapshot(prev, { checkedAt: NOW, items: [], lanes: [lane('jobs', 'empty')] });
    expect(next.lanes.find((l) => l.lane === 'dns')).toMatchObject({ status: 'found', checkedAt: OLD, count: 1 });
  });
});

describe('open tech categories', () => {
  it('combines lanes into one item per technology and names the strongest lane', () => {
    const snapshot: OpenTechStackSnapshot = {
      version: 1,
      checkedAt: NOW,
      sample: true,
      apolloFallback: null,
      lanes: [],
      items: [det('Microsoft Azure', 'jobs', 0.6), det('Microsoft Azure', 'dns', 0.85), det('Databricks', 'jobs', 0.63, 'Data')],
    };
    const cats = openTechStackCategories(snapshot);
    expect(cats.map((c) => c.label).sort()).toEqual(['Cloud', 'Data']);
    const azure = cats.find((c) => c.label === 'Cloud')!.items[0]!;
    expect(azure).toMatchObject({ name: 'Microsoft Azure', source: 'open_data:dns', confidence: 0.94, sample: true });
    expect(azure.evidence?.record).toBe('dns saw Microsoft Azure. Also seen in Jobs');
  });

  it('reports coverage and the Apollo fallback threshold', () => {
    const snapshot = mergeOpenTechSnapshot(null, { checkedAt: NOW, items: [det('A', 'dns', 0.9), det('A', 'web', 0.9), det('B', 'dns', 0.9)], lanes: [lane('dns', 'found'), lane('web', 'found')] });
    const coverage = coverageFromSnapshot(snapshot)!;
    expect(coverage.openItems).toBe(2);
    expect(coverage.apolloThreshold).toBe(5);
    expect(needsApolloFallback(coverage.openItems)).toBe(true);
    expect(needsApolloFallback(5)).toBe(false);
    expect(coverageFromSnapshot(null)).toBeNull();
  });
});

describe('source chip labels', () => {
  it('uses plain words for every source', () => {
    expect(techSourceLabel('open_data:dns')).toBe('DNS');
    expect(techSourceLabel('open_data:ct')).toBe('Cert');
    expect(techSourceLabel('open_data:web')).toBe('Website');
    expect(techSourceLabel('open_data:jobs')).toBe('Jobs');
    expect(techSourceLabel('open_data:github')).toBe('GitHub');
    expect(techSourceLabel('enrichment:apollo')).toBe('Apollo');
    expect(techSourceLabel('manual')).toBe('Manual');
    expect(techSourceLabel('meeting_notes')).toBe('Meeting notes');
    expect(techSourceLabel('manual:accepted:open_data:dns')).toBe('DNS');
    expect(techSourceLabel('manual:accepted:enrichment:apollo')).toBe('Apollo');
  });
});
