import { describe, expect, it } from 'vitest';

import {
  momentumVerdict,
  classifySignalText,
  cleanText,
  computeMomentum,
  importanceScore,
  oneLine,
  signalDedupeKey,
  stripPublisher,
  themeForText,
  titleSimilarity,
  trendFor,
  type MomentumData,
} from './account-signals.js';

const NOW = new Date('2026-10-31T12:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

describe('classifySignalText', () => {
  it.each([
    ['Acme raises $40M Series C to expand in Europe', 'FUNDING_ROUND', 'funding'],
    ['Acme launches new mobile banking app', 'PRODUCT_LAUNCH', 'launch'],
    ['Acme appoints Jane Doe as chief technology officer', 'LEADERSHIP_CHANGE', 'exec_move'],
    ['Acme to acquire Beta Systems for $1.2bn', 'M_AND_A', 'm_and_a'],
    ['Acme announces 500 job cuts in restructuring', 'LAYOFFS', 'risk'],
    ['Acme fined by regulator over data breach', 'NEWS_SIGNAL', 'risk'],
    ['Acme third-quarter profit rose 12%', 'EARNINGS_RELEASE', 'earnings'],
    ['Acme partners with Microsoft on cloud', 'PARTNERSHIP', 'partnership'],
    ['Acme opens new technology hub in Lisbon', 'STRATEGIC_INITIATIVE', 'initiative'],
    ['Acme is hiring 300 engineers', 'HIRING_SPIKE', 'hiring'],
    ['Acme sponsors local marathon', 'NEWS_SIGNAL', 'news'],
  ])('%s -> %s', (title, kind, category) => {
    const c = classifySignalText(title);
    expect(c.kind).toBe(kind);
    expect(c.category).toBe(category);
  });

  it('reads earnings tone from the headline', () => {
    expect(classifySignalText('Acme quarterly results miss estimates').implication).toBe('RISK');
    expect(classifySignalText('Acme earnings beat estimates on record revenue').sentiment).toBeGreaterThan(0);
  });

  it('treats a departure as neutral to slightly negative', () => {
    const c = classifySignalText('Acme CFO steps down');
    expect(c.kind).toBe('LEADERSHIP_CHANGE');
    expect(c.sentiment).toBeLessThan(0);
  });
});

describe('text helpers', () => {
  it('cleans tags, entities and long dashes', () => {
    expect(cleanText('<b>Acme</b> &amp; Co \u2014 wins')).toBe('Acme & Co, wins');
  });
  it('strips the publisher suffix', () => {
    expect(stripPublisher('Acme raises $40M to grow - Reuters', 'Reuters')).toBe('Acme raises $40M to grow');
    expect(stripPublisher('Acme opens a new office in Porto | Business Wire')).toBe('Acme opens a new office in Porto');
  });
  it('keeps one line under the limit on a word boundary', () => {
    const s = oneLine('word '.repeat(80), 60);
    expect(s.length).toBeLessThanOrEqual(60);
    expect(s.endsWith('…')).toBe(true);
  });
});

describe('dedupe', () => {
  it('gives the same key to the same story across outlets', () => {
    const a = signalDedupeKey('FUNDING_ROUND', 'Acme raises $40M Series C led by Atomico', 'Acme');
    const b = signalDedupeKey('FUNDING_ROUND', 'Series C: Acme raises $40M, led by Atomico', 'Acme');
    expect(a).toBe(b);
    expect(a.length).toBeLessThanOrEqual(64);
    expect(signalDedupeKey('PRODUCT_LAUNCH', 'Acme launches app', 'Acme')).not.toBe(a);
  });
  it('scores fuzzy similarity', () => {
    expect(titleSimilarity('Acme raises $40M Series C', 'Acme closes $40M Series C round', 'Acme')).toBeGreaterThanOrEqual(0.4);
    expect(titleSimilarity('Acme raises $40M', 'Acme CFO steps down', 'Acme')).toBeLessThan(0.2);
  });
});

describe('importanceScore', () => {
  it('ranks funding from the company above generic news', () => {
    const funding = importanceScore({ kind: 'FUNDING_ROUND', implication: 'OPPORTUNITY', source: 'company_rss' });
    const news = importanceScore({ kind: 'NEWS_SIGNAL', implication: 'NEUTRAL', source: 'gdelt' });
    expect(funding).toBeGreaterThanOrEqual(70);
    expect(news).toBeLessThan(50);
  });
  it('adds weight for extra outlets, capped at 100', () => {
    const one = importanceScore({ kind: 'M_AND_A', implication: 'OPPORTUNITY', source: 'gdelt' });
    const many = importanceScore({ kind: 'M_AND_A', implication: 'OPPORTUNITY', source: 'gdelt', mentions: 6 });
    expect(many - one).toBe(15);
    expect(importanceScore({ kind: 'INSOLVENCY', implication: 'RISK', source: 'companies_house', mentions: 9 })).toBe(100);
  });
});

describe('computeMomentum', () => {
  const growing: MomentumData = {
    opps: [
      { createdAt: daysAgo(200), closedAt: null, outcome: 'open', valueMicros: 1_000_000_000_000n },
      { createdAt: daysAgo(40), closedAt: null, outcome: 'open', valueMicros: 2_000_000_000_000n },
      { createdAt: daysAgo(150), closedAt: daysAgo(20), outcome: 'won', valueMicros: 500_000_000_000n },
    ],
    meetings: [daysAgo(3), daysAgo(12), daysAgo(25), daysAgo(50), daysAgo(100)],
    postings: [daysAgo(2), daysAgo(5), daysAgo(9), daysAgo(15), daysAgo(40)],
    events: [{ occurredAt: daysAgo(10), importance: 75, sentiment: 0.8, category: 'funding' }],
    headcountGrowth12m: 0.08,
  };

  it('reads a growing account as gaining with plain-English drivers', () => {
    const m = computeMomentum(growing, NOW);
    expect(m.score).toBeGreaterThan(65);
    expect(m.trend).toBe('gaining');
    expect(m.series).toHaveLength(13);
    expect(m.series.at(-1)?.score).toBe(m.score);
    expect(m.drivers.map((d) => d.key)).toEqual(expect.arrayContaining(['pipeline', 'meetings', 'hiring', 'news', 'winloss']));
    expect(m.verdict.startsWith('Gaining traction')).toBe(true);
    expect(m.verdict).not.toMatch(/[\u2014\u2013]/);
    expect(m.coverage).toBe(1);
  });

  it('reads a cooling account as declining', () => {
    const m = computeMomentum(
      {
        opps: [
          { createdAt: daysAgo(300), closedAt: daysAgo(10), outcome: 'lost', valueMicros: 3_000_000_000_000n },
          { createdAt: daysAgo(300), closedAt: null, outcome: 'open', valueMicros: 500_000_000_000n },
        ],
        meetings: [daysAgo(95), daysAgo(110), daysAgo(130)],
        postings: [],
        events: [{ occurredAt: daysAgo(5), importance: 75, sentiment: -0.7, category: 'risk' }],
        headcountGrowth12m: -0.05,
      },
      NOW,
    );
    expect(m.score).toBeLessThan(40);
    expect(m.trend).toBe('declining');
    expect(m.drivers[0]?.direction).toBe('down');
    expect(m.verdict.startsWith('Losing momentum')).toBe(true);
  });

  it('says when the level and the 4-week trend disagree', () => {
    expect(momentumVerdict('declining', 70, [], 1).startsWith('High level, but down over 4 weeks')).toBe(true);
    expect(momentumVerdict('declining', 45, [], 1).startsWith('Losing momentum over 4 weeks')).toBe(true);
    expect(momentumVerdict('gaining', 35, [], 1).startsWith('Low level, but up over 4 weeks')).toBe(true);
    expect(momentumVerdict('gaining', 80, [], 1).startsWith('Gaining traction over 4 weeks')).toBe(true);
    expect(momentumVerdict('steady', 70, [], 1).startsWith('Healthy and steady')).toBe(true);
  });

  it('stays neutral with no data and says so', () => {
    const m = computeMomentum({ opps: [], meetings: [], postings: [], events: [], headcountGrowth12m: null }, NOW);
    expect(m.score).toBe(50);
    expect(m.trend).toBe('steady');
    expect(m.drivers).toHaveLength(0);
    expect(m.verdict).toMatch(/Not enough signal/);
  });

  it('drivers add up to the distance from neutral', () => {
    const m = computeMomentum(growing, NOW);
    const sum = m.drivers.reduce((s, d) => s + d.points, 0);
    expect(Math.abs(50 + sum - m.score)).toBeLessThanOrEqual(1);
  });

  it('maps deltas to trends', () => {
    expect(trendFor(6)).toBe('gaining');
    expect(trendFor(-5)).toBe('declining');
    expect(trendFor(2)).toBe('steady');
  });
});

describe('themeForText', () => {
  it('maps text to an offering theme', () => {
    expect(themeForText('Data platform modernisation')).toBe('data_ai');
    expect(themeForText('Zero Trust rollout')).toBe('cyber');
    expect(themeForText('Acquisition of Beta')).toBe('m_and_a');
    expect(themeForText('Opens office in Lisbon')).toBe('expansion');
  });
});

describe('importance for risk news', () => {
  it('lifts a fine or lawsuit above the alert line', async () => {
    const { classifySignalText, importanceScore, ALERT_IMPORTANCE } = await import('./account-signals.js');
    const c = classifySignalText('DNB Bank fined by regulator over anti-money laundering controls');
    expect(c.implication).toBe('RISK');
    expect(importanceScore({ kind: c.kind, implication: c.implication, source: 'gdelt' })).toBeGreaterThanOrEqual(ALERT_IMPORTANCE);
  });
});
