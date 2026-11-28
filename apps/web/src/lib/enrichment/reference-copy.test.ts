// Fixture enrichment stays behind sample:true. The words a seller reads must
// call those rows reference records. Sample, illustrative, and live tell the
// seller the product is a demo, so the chip, the firmographics fallback, the
// fixture source label, and the unset-provider notices are rejected.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Firmographics } from '@bidstack/shared';
import { describe, expect, it } from 'vitest';

import { fromApi, isSampleStatus, noticeFor, PROVIDER_LABEL } from './live';
import { mockEnrichment } from './mock';

const webRoot = join(dirname(fileURLToPath(import.meta.url)), '../../..');

const BADGE = 'Reference';
const BADGE_TITLE = 'Reference records until company enrichment is connected';
const FALLBACK = 'Reference records until company enrichment is connected.';
const FIXTURE = 'Reference records';
const NOT_CONFIGURED =
  'Company enrichment is not configured (no provider key), so these are reference records.';
const NOT_ENRICHED = 'This account has not been enriched yet, so these are reference records.';

/** Seller-facing demo words. Identifiers such as sample:true are not in these strings. */
const DEMO_COPY = /\bsample\b|\billustrative\b|\blive\b/i;

function read(rel: string): string {
  return readFileSync(join(webRoot, rel), 'utf8');
}

function badgeCopy(src: string): { title: string; text: string } {
  const match = src.match(/className="en-sample" title="([^"]*)">([^<]*)<\/span>/);
  if (!match?.[1] || match[2] == null || match[2] === '') {
    throw new Error('SampleBadge is missing its seller-facing label');
  }
  return { title: match[1], text: match[2] };
}

function firmographicsFallback(src: string): string {
  const match = src.match(/d\.sample \? '([^']*)' : null/);
  if (!match?.[1]) throw new Error('firmographics sample notice is missing');
  return match[1];
}

describe('enrichment reference copy', () => {
  it('keeps fixture behavior and the real provider labels', () => {
    expect(isSampleStatus({ status: 'not_configured', providers: {} } as never)).toBe(true);
    expect(isSampleStatus({ status: 'not_enriched', providers: {} } as never)).toBe(true);
    expect(isSampleStatus({ status: 'ok', providers: { apollo: { status: 'ok' } } } as never)).toBe(false);
    expect(mockEnrichment('acct-1').sample).toBe(true);
    expect(mockEnrichment('acct-1').notice).toBeNull();
    expect(PROVIDER_LABEL.apollo).toBe('Apollo');
    expect(PROVIDER_LABEL.seamless).toBe('Seamless.AI');
    // A real run is not relabelled as reference records, and it is not called live here.
    expect(noticeFor('pending')).toBe(
      'Enrichment is still running; some fields may fill in on the next run.',
    );
    expect(noticeFor('ok')).toBeNull();
  });

  it('calls an unset provider and a fixture source reference records', () => {
    expect(PROVIDER_LABEL.fixture).toBe(FIXTURE);
    expect(noticeFor('not_configured')).toBe(NOT_CONFIGURED);
    expect(noticeFor('not_enriched')).toBe(NOT_ENRICHED);
    const joined = [PROVIDER_LABEL.fixture, noticeFor('not_configured'), noticeFor('not_enriched')].join(' ');
    expect(joined).toContain('no provider key');
    expect(joined).toContain('reference records');
    expect(joined).not.toMatch(DEMO_COPY);

    const at = '2026-10-31T21:00:00.000Z';
    const mapped = fromApi(
      {
        companyId: 'c1',
        status: 'ok',
        stale: false,
        fetchedAt: at,
        domain: 'example.com',
        annualRevenueUsd: null,
        revenueRange: null,
        employeeCount: 10,
        employeeRange: null,
        headcountGrowth12m: null,
        industry: null,
        industries: [],
        locations: [],
        providers: { apollo: { status: 'ok' } },
        provenance: { employeeCount: { source: 'fixture', fetchedAt: at } },
      } as unknown as Firmographics,
      null,
      null,
    );
    // The account came back from the API, so it is not a fixture page. The field source still is.
    expect(mapped.sample).toBe(false);
    expect(mapped.firmographics.headcount?.source).toBe(FIXTURE);
  });

  it('uses reference wording on the chip and the firmographics fallback', () => {
    const badge = badgeCopy(read('src/components/enrichment/SourceNote.tsx'));
    const fallback = firmographicsFallback(read('src/components/enrichment/FirmographicsStrip.tsx'));
    expect(badge).toEqual({ title: BADGE_TITLE, text: BADGE });
    expect(fallback).toBe(FALLBACK);
    expect(`${badge.title} ${badge.text} ${fallback}`).not.toMatch(DEMO_COPY);
  });
});
