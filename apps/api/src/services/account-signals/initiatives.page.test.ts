import { describe, expect, it } from 'vitest';

import type { Initiative, InitiativeTheme } from '@bidstack/shared';

import { applyMeetingEvidence, confirmThemeFromProbes, evidencePageCapped, meetingEvidenceLines, readBoundedPages, soldThemesFromSolutions, themeConfirmedByRows } from './initiatives';

describe('evidencePageCapped', () => {
  it('names a full news or meeting page only when another row exists', () => {
    // WHY: the latest 100 items were read as every initiative signal from the year.
    expect(evidencePageCapped(100, 101, 2, 2)).toBe(true);
    expect(evidencePageCapped(3, 3, 100, 140)).toBe(true);
    expect(evidencePageCapped(100, 100, 100, 100)).toBe(false);
    expect(evidencePageCapped(4, 4, 1, 1)).toBe(false);
  });

  it('keeps a solution that sits past the first page', async () => {
    // WHY: take 100 marked a later Cloud practice as unsold.
    const result = await readBoundedPages(async (cursor) => {
      if (!cursor) return Array.from({ length: 1000 }, (_, index) => ({ id: `a${index}`, name: 'other' }));
      return [{ id: 'late', name: 'Cloud practice' }];
    }, 1000, 5000);
    expect(result.capped).toBe(false);
    expect(result.rows.at(-1)?.name).toBe('Cloud practice');
  });

  it('stops a solution read that never ends', async () => {
    const result = await readBoundedPages(async () => [{ id: 'x', name: 'loop' }, ...Array.from({ length: 999 }, (_, index) => ({ id: `b${index}`, name: 'other' }))], 1000, 2000);
    expect(result.capped).toBe(true);
    expect(result.rows.length).toBeGreaterThanOrEqual(2000);
  });

  it('marks cloud sold from a solution the page ceiling would hide', () => {
    // WHY: themeForText on "Cloud practice" is cloud, so a probe that fetches that row must count it as sold.
    expect(soldThemesFromSolutions([{ name: 'Cloud practice', category: 'general' }]).has('cloud')).toBe(true);
  });

  it('does not treat cloudflare as a cloud sale', () => {
    // WHY: a contains search for cloud returns cloudflare, which is not the cloud theme.
    expect(themeConfirmedByRows('cloud', [{ name: 'Cloudflare DNS', category: 'general' }])).toBe(false);
    expect(themeConfirmedByRows('cloud', [{ name: 'Cloud practice', category: 'general' }])).toBe(true);
  });

  it('keeps looking after a noisy probe word', async () => {
    // WHY: five Cloudflare rows used to fill the cloud lookup and hide Kubernetes.
    const words: string[] = [];
    const confirmed = await confirmThemeFromProbes('cloud', async (word) => {
      words.push(word);
      if (word === 'cloud') return Array.from({ length: 5 }, () => ({ name: 'Cloudflare DNS', category: 'general' }));
      if (word === 'kubernetes') return [{ name: 'Kubernetes landing zone', category: 'general' }];
      return [];
    });
    expect(confirmed).toBe(true);
    expect(words).toEqual(['cloud', 'kubernetes']);
  });

  it('keeps the seventh line from a meeting', () => {
    // WHY: slice(0, 6) dropped a challenge before it could be evidence.
    const lines = meetingEvidenceLines({
      opportunities: ['one', 'two', 'three'],
      challenges: ['four', 'five', 'six', 'seven'],
    });
    expect(lines).toHaveLength(7);
    expect(lines[6]).toBe('seven');
  });

  it('opens a theme a meeting names and skips chatter', () => {
    // WHY: dropping an unmatched line used to be required, because the old default turned chatter into expansion.
    const board = new Map<InitiativeTheme, Initiative>();
    applyMeetingEvidence(
      board,
      {
        title: 'Q3 review',
        heldAt: new Date('2026-10-01T12:00:00.000Z'),
        opportunities: ['Kubernetes landing zone', 'follow up next week'],
        challenges: ['Kubernetes cost review'],
      },
      (theme, title, rationale, score, sample) => blankInitiative(theme, title, rationale, score, sample),
      (it, at) => {
        it.lastSeen = at;
      },
    );
    expect([...board.keys()]).toEqual(['cloud']);
    const cloud = board.get('cloud');
    expect(cloud?.confidenceScore).toBe(0.35);
    expect(cloud?.title).toBe('Kubernetes landing zone');
    expect(cloud?.rationale).toBe('Raised in a meeting: Q3 review');
    expect(cloud?.evidence.map((item) => item.title)).toEqual([
      'Q3 review: Kubernetes landing zone',
      'Q3 review: Kubernetes cost review',
    ]);
    expect(cloud?.lastSeen).toBe('2026-10-01T12:00:00.000Z');
  });

  it('raises confidence once when the meeting repeats a theme already on the board', () => {
    const board = new Map<InitiativeTheme, Initiative>();
    const existing = blankInitiative('cloud', 'Cloud practice', 'From hiring', 0.6, false);
    board.set('cloud', existing);
    applyMeetingEvidence(
      board,
      {
        title: 'Q3 review',
        heldAt: new Date('2026-10-01T12:00:00.000Z'),
        opportunities: ['Kubernetes landing zone'],
        challenges: ['Azure migration'],
      },
      (theme, title, rationale, score, sample) => blankInitiative(theme, title, rationale, score, sample),
      () => undefined,
    );
    expect(board.size).toBe(1);
    expect(existing.confidenceScore).toBeCloseTo(0.7);
    expect(existing.evidence).toHaveLength(2);
    expect(existing.title).toBe('Cloud practice');
  });
});

function blankInitiative(
  theme: InitiativeTheme,
  title: string,
  rationale: string,
  score: number,
  sample: boolean,
): Initiative {
  return {
    id: `init:${theme}`,
    title,
    theme,
    themeLabel: theme,
    rationale,
    confidence: 'low',
    confidenceScore: score,
    firstSeen: null,
    lastSeen: null,
    evidence: [],
    hook: { offering: '', pitch: '', nextStep: '', alreadySold: false },
    sample,
  };
}
