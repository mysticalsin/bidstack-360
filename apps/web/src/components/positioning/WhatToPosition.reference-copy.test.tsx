import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AccountPositioning, EvidenceChip, PositioningPlay } from '@bidstack/shared';

const state: { pos: AccountPositioning | null } = { pos: null };
vi.mock('@/hooks/useAccountPositioning', () => ({
  useAccountPositioning: () => ({ isLoading: false, isError: false, data: state.pos, refetch: vi.fn() }),
}));
vi.mock('@/hooks/useMsaLeverage', () => ({
  useMsaLeverage: () => ({ isLoading: false, isError: false, data: { items: [], hemaPharmaCount: 0 } }),
}));

import { WhatToPosition } from './WhatToPosition';

afterEach(cleanup);

// Sellers read the badge. The sample flag stays the fixture marker.
const chip = (sample: boolean, label: string): EvidenceChip => ({
  kind: 'financial',
  label,
  url: null,
  anchor: 'financial-health',
  at: '2025-12-31',
  source: 'Filed statements',
  sample,
});

const play = (sample: boolean, evidenceSample: boolean): PositioningPlay => ({
  rank: 1,
  theme: 'm_and_a',
  themeLabel: 'Integration',
  offering: 'Integration support',
  headline: 'Filed acquisition activity',
  whyNow: [chip(evidenceSample, 'Acquisition spend on file')],
  approach: [],
  approachGap: 'No sponsor mapped yet.',
  talkingPoints: ['Ask about the integration plan.'],
  firstStep: 'Offer a planning session.',
  confidence: 'medium',
  confidenceScore: 0.55,
  alreadySold: false,
  dealRange: null,
  sample,
});

function positioning(opts: { playSample: boolean; evidenceSample: boolean; gapSample?: boolean }): AccountPositioning {
  return {
    companyId: 'fixture-co',
    sample: opts.playSample,
    computedAt: '2026-11-01T00:00:00Z',
    brief: {
      name: 'Harbor Fixture',
      tierLabel: 'Strategic',
      industry: 'Software',
      country: 'PT',
      employees: { value: 120, source: 'Account record' },
      momentum: null,
      financials: null,
      pipeline: { openCount: 0, openMicros: '0', won24m: 0, lost24m: 0 },
      people: { known: 0, senior: 0, metLast12m: 0, lastMeeting: null },
      topSignal: null,
    },
    plays: [play(opts.playSample, opts.evidenceSample)],
    gaps: opts.gapSample
      ? [{
        kind: 'stale_data',
        severity: 'low',
        title: 'Filing is old',
        detail: 'The latest filing on file is from a prior year.',
        evidence: [chip(true, 'Prior-year filing')],
      }]
      : [],
  };
}

describe('WhatToPosition reference provenance', () => {
  it('badges a fixture play Reference and keeps the sg-sample class', () => {
    state.pos = positioning({ playSample: true, evidenceSample: false });
    render(<WhatToPosition companyId="fixture-co" />);
    const offering = screen.getByTestId('wp-play-1').querySelector('.wp-offering');
    const badge = offering?.querySelector('.sg-sample');
    expect(badge).toBeTruthy();
    expect(badge?.textContent).toBe('Reference');
    expect(offering?.textContent).not.toMatch(/\bSample\b/);
    expect(screen.getByTestId('wp-play-1').querySelector('.wp-chip .sg-sample')).toBeNull();
  });

  it('badges fixture evidence chips Reference on the play and on a gap', () => {
    state.pos = positioning({ playSample: false, evidenceSample: true, gapSample: true });
    render(<WhatToPosition companyId="fixture-co" />);
    const playEl = screen.getByTestId('wp-play-1');
    expect(playEl.querySelector('.wp-offering .sg-sample')).toBeNull();
    const chipBadge = playEl.querySelector('.wp-chip .sg-sample');
    expect(chipBadge).toBeTruthy();
    expect(chipBadge?.textContent).toBe('Reference');
    expect(playEl.querySelector('.wp-chip')?.textContent).not.toMatch(/\bSample\b/);

    const gaps = screen.getByTestId('gaps-risks');
    const gapBadge = gaps.querySelector('.wp-chip .sg-sample');
    expect(gapBadge).toBeTruthy();
    expect(gapBadge?.textContent).toBe('Reference');
    expect(gaps.querySelector('.wp-chip')?.textContent).not.toMatch(/\bSample\b/);
  });

  it('shows no provenance badge when the play and the evidence are not fixture rows', () => {
    state.pos = positioning({ playSample: false, evidenceSample: false });
    render(<WhatToPosition companyId="fixture-co" />);
    const root = screen.getByTestId('what-to-position');
    expect(root.querySelector('.sg-sample')).toBeNull();
    expect(root.textContent).not.toMatch(/\bSample\b/);
    expect(root.textContent).not.toMatch(/\bReference\b/);
  });
});
