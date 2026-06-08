import { describe, expect, it } from 'vitest';

import {
  buildUsaSpendingCompetitorInsights,
  enforceCitations,
  fetchGroundedDocuments,
  findingsToInsightDrafts,
  normalizeUrl,
  parseCompetitorFindings,
  usaSpendingAwardUrl,
} from './index.js';

const FIXED_NOW = new Date('2026-06-04T00:00:00.000Z');

describe('normalizeUrl', () => {
  it('lowercases scheme+host, drops fragment/trailing-slash, but KEEPS path case', () => {
    // RFC 3986: host is case-insensitive, path is NOT.
    expect(normalizeUrl('https://Example.com/Path/#frag')).toBe('https://example.com/Path');
    expect(normalizeUrl('https://example.com/')).toBe('https://example.com');
  });
  it('treats path-case and query-case variants as DISTINCT (no-hallucination)', () => {
    // The original bug: lowercasing the whole URL let an invented /pricing.md
    // collide with a fetched /PRICING.md and bypass enforceCitations.
    expect(normalizeUrl('https://x.example/PRICING.md')).not.toBe(
      normalizeUrl('https://x.example/pricing.md'),
    );
    expect(normalizeUrl('https://x.example/f?id=aB3xQ')).not.toBe(
      normalizeUrl('https://x.example/f?id=ab3xq'),
    );
  });
  it('drops the default port and userinfo', () => {
    expect(normalizeUrl('https://user:pass@x.example:443/p')).toBe('https://x.example/p');
    expect(normalizeUrl('http://x.example:80/p')).toBe('http://x.example/p');
    expect(normalizeUrl('https://x.example:8443/p')).toBe('https://x.example:8443/p');
  });
  it('returns null for non-URLs', () => {
    expect(normalizeUrl('not a url')).toBeNull();
  });
});

describe('enforceCitations rejects path-case-variant citations (regression)', () => {
  it('drops a finding citing a never-fetched case variant of a real URL', () => {
    // Fetched: .../PRICING.md ; model invents .../pricing.md (a different file).
    const { kept, dropped } = enforceCitations(
      [{ sourceUrl: 'https://raw.example/Acme/Specs/main/pricing.md', n: 1 }],
      ['https://raw.example/Acme/Specs/main/PRICING.md'],
    );
    expect(kept).toHaveLength(0);
    expect(dropped).toHaveLength(1);
  });
});

describe('enforceCitations (no-hallucination guarantee)', () => {
  it('keeps findings that cite a fetched source and drops the rest', () => {
    const findings = [
      { sourceUrl: 'https://real.example/a', n: 1 },
      { sourceUrl: 'https://invented.example/x', n: 2 },
      { sourceUrl: 'https://REAL.example/a/', n: 3 }, // same as #1 after normalize
    ];
    const { kept, dropped } = enforceCitations(findings, ['https://real.example/a']);
    expect(kept.map((f) => f.n)).toEqual([1, 3]);
    expect(dropped.map((f) => f.n)).toEqual([2]);
  });

  it('drops everything when no sources were fetched', () => {
    const { kept, dropped } = enforceCitations([{ sourceUrl: 'https://x.example/1' }], []);
    expect(kept).toHaveLength(0);
    expect(dropped).toHaveLength(1);
  });
});

describe('parseCompetitorFindings', () => {
  const allowed = ['https://src.example/doc'];

  it('parses valid JSON and keeps only cited findings', () => {
    const raw = JSON.stringify({
      findings: [
        {
          category: 'pricing',
          title: 'Won at £2m',
          summary: 'Public case study.',
          sourceUrl: 'https://src.example/doc',
        },
        {
          category: 'win_loss',
          title: 'Made-up claim',
          summary: 'No real source.',
          sourceUrl: 'https://hallucinated.example/nope',
        },
      ],
    });
    const out = parseCompetitorFindings(raw, allowed);
    expect(out.parseError).toBe(false);
    expect(out.findings).toHaveLength(1);
    expect(out.findings[0]?.title).toBe('Won at £2m');
    expect(out.dropped).toBe(1);
  });

  it('handles markdown-fenced JSON', () => {
    const raw = '```json\n{ "findings": [] }\n```';
    expect(parseCompetitorFindings(raw, allowed)).toEqual({
      findings: [],
      dropped: 0,
      parseError: false,
    });
  });

  it('fails closed on non-JSON (no grounded findings surfaced)', () => {
    const out = parseCompetitorFindings('the competitor is cheaper, trust me', allowed);
    expect(out.parseError).toBe(true);
    expect(out.findings).toEqual([]);
  });

  it('fails closed when a finding violates the schema (missing sourceUrl)', () => {
    const raw = JSON.stringify({ findings: [{ category: 'pricing', title: 't', summary: 's' }] });
    const out = parseCompetitorFindings(raw, allowed);
    expect(out.parseError).toBe(true);
  });
});

describe('findingsToInsightDrafts', () => {
  it('maps confidence to bps and carries amount metadata', () => {
    const drafts = findingsToInsightDrafts(
      [
        {
          category: 'pricing',
          title: 't',
          summary: 's',
          sourceUrl: 'https://x.example/1',
          confidence: 0.8,
          amount: 1000,
          currency: 'USD',
        },
      ],
      'web',
    );
    expect(drafts[0]?.confidenceBps).toBe(8000);
    expect(drafts[0]?.metadata).toEqual({ amount: 1000, currency: 'USD' });
  });
});

describe('usaSpendingAwardUrl', () => {
  it('builds a specific award page when an id is present', () => {
    expect(usaSpendingAwardUrl('CONT_AWD_1')).toBe('https://www.usaspending.gov/award/CONT_AWD_1');
    expect(usaSpendingAwardUrl()).toBe('https://www.usaspending.gov/search/');
  });
});

describe('buildUsaSpendingCompetitorInsights', () => {
  it('maps awards to cited pricing insights', async () => {
    const fetchImpl = async () =>
      new Response(
        JSON.stringify({
          results: [
            {
              'Award ID': 'A1',
              'Recipient Name': 'Acme Corp',
              'Award Amount': 5_000_000,
              'Awarding Agency': 'GSA',
              'Start Date': '2025-01-01',
              generated_unique_award_id: 'CONT_AWD_A1',
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );

    const insights = await buildUsaSpendingCompetitorInsights({
      competitorName: 'Acme Corp',
      now: FIXED_NOW,
      fetchImpl,
    });

    expect(insights).toHaveLength(1);
    expect(insights[0]?.category).toBe('pricing');
    expect(insights[0]?.sourceUrl).toBe('https://www.usaspending.gov/award/CONT_AWD_A1');
    expect(insights[0]?.summary).toContain('$5,000,000');
    expect(insights[0]?.provider).toBe('usaspending');
  });

  it('returns [] (never throws / never invents) when the API errors', async () => {
    const fetchImpl = async () => new Response('boom', { status: 500 });
    const insights = await buildUsaSpendingCompetitorInsights({
      competitorName: 'Acme Corp',
      now: FIXED_NOW,
      fetchImpl,
    });
    expect(insights).toEqual([]);
  });

  it('ignores too-short names', async () => {
    let called = false;
    const fetchImpl = async () => {
      called = true;
      return new Response('{}', { status: 200 });
    };
    const insights = await buildUsaSpendingCompetitorInsights({
      competitorName: 'A',
      now: FIXED_NOW,
      fetchImpl,
    });
    expect(insights).toEqual([]);
    expect(called).toBe(false);
  });
});

describe('fetchGroundedDocuments (SSRF-guarded)', () => {
  it('fetches public pages and refuses internal addresses', async () => {
    const fetchImpl = async (input: string | URL) => {
      const url = input.toString();
      return new Response(`<html><head><title>Acme</title></head><body>Public ${url}</body></html>`, {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });
    };

    const docs = await fetchGroundedDocuments({
      urls: [
        'https://public.example/a',
        'http://127.0.0.1/internal', // SSRF — must be refused
        'http://169.254.169.254/latest/meta-data', // cloud metadata — must be refused
        'ftp://public.example/file', // wrong protocol — must be refused
      ],
      fetchImpl,
    });

    expect(docs).toHaveLength(1);
    expect(docs[0]?.url).toBe('https://public.example/a');
    expect(docs[0]?.title).toBe('Acme');
    expect(docs[0]?.snippet).toContain('Public');
  });

  it('drops a public page that redirects to an internal address (no SSRF exfil)', async () => {
    const fetchImpl = async (input: string | URL) => {
      const url = input.toString();
      // A guard-passing public host 302s to cloud metadata — must NOT be followed.
      if (url === 'https://redirector.example/go') {
        return new Response(null, {
          status: 302,
          headers: { location: 'http://169.254.169.254/latest/meta-data/iam/' },
        });
      }
      return new Response('<html><body>internal secret</body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });
    };
    const docs = await fetchGroundedDocuments({
      urls: ['https://redirector.example/go'],
      fetchImpl,
    });
    expect(docs).toHaveLength(0);
  });

  it('follows a redirect to another public page and re-validates the hop', async () => {
    const fetchImpl = async (input: string | URL) => {
      const url = input.toString();
      if (url === 'https://a.example/start') {
        return new Response(null, { status: 301, headers: { location: 'https://b.example/final' } });
      }
      return new Response('<html><head><title>Final</title></head><body>Final content</body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });
    };
    const docs = await fetchGroundedDocuments({ urls: ['https://a.example/start'], fetchImpl });
    expect(docs).toHaveLength(1);
    expect(docs[0]?.snippet).toContain('Final');
  });
});
