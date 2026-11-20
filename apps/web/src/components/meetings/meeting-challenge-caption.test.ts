import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  MEETING_CHALLENGES_DRAWN,
  meetingChallengeLabel,
  meetingChallengePage,
  shownMeetingChallenges,
} from './meeting-challenge-caption';

/**
 * How many challenges the rollup keeps before the card cuts the page. A slice
 * at the limit drops the later challenge before the caption can tell that the
 * page is not every challenge.
 */
function meetingChallengeQueryTake(src: string): number {
  const start = src.indexOf("'/meeting-intel/accounts/:groupId/challenges'");
  const end = src.indexOf('cross-region flags', start);
  const fn = src.slice(start, end);
  const probes = fn.includes('req.query.limit + 1') && fn.includes('challengesContinue');
  const blind = /\.slice\(0,\s*req\.query\.limit\)/.test(fn) && !fn.includes('req.query.limit + 1');
  return probes && !blind ? MEETING_CHALLENGES_DRAWN + 1 : MEETING_CHALLENGES_DRAWN;
}

function challenge(name: string) {
  return { challenge: name, mentions: 1 };
}

describe('meeting challenge page', () => {
  it('does not call the loaded page every challenge when a later challenge was loaded', () => {
    // WHY: the account card kept twenty-five challenges and printed that
    // length as every challenge ("Show all 25"). Cutting a twenty-sixth
    // challenge left that label as if the page were the whole rollup. One
    // more loaded row means those twenty-five are not every challenge. The
    // extra row is dropped. A shorter list keeps "Show all N". No challenge
    // total is invented.
    const src = readFileSync(
      path.resolve(process.cwd(), '../api/src/routes/meeting-intel.ts'),
      'utf8',
    );
    const start = src.indexOf("'/meeting-intel/accounts/:groupId/challenges'");
    const handler = src.slice(start, src.indexOf('cross-region flags', start));
    expect(handler).toContain('req.query.limit + 1');
    expect(handler).toContain('challengesContinue');
    expect(handler).not.toMatch(/\.slice\(0,\s*req\.query\.limit\)\s*\.map/);

    const view = readFileSync(path.resolve(process.cwd(), 'src/components/meetings/WhoWeMetCard.tsx'), 'utf8');
    const card = view.slice(view.indexOf('export function WhoWeMetCard'));
    expect(card).toContain('shownMeetingChallenges(');
    expect(card).toContain('meetingChallengeLabel(');
    expect(card).not.toContain('`Show all ${items.length}`');

    const rows = Array.from({ length: MEETING_CHALLENGES_DRAWN + 1 }, (_, n) =>
      challenge(n === MEETING_CHALLENGES_DRAWN ? 'probe-challenge' : `challenge-${n}`),
    );
    const loaded = rows.slice(0, meetingChallengeQueryTake(src));
    const page = meetingChallengePage(loaded);
    const shown = shownMeetingChallenges(page.items, page.pageContinues);
    const caption = meetingChallengeLabel(shown.items.length, shown.pageContinues, false);
    expect(caption).toBe('25 in the latest 25, not every challenge');
    expect(caption).not.toBe('Show all 25');
    expect(caption).not.toBe(`Show all ${rows.length}`);
    expect(caption).not.toMatch(/26|Show all|View all/i);
    expect(shown.items).toHaveLength(MEETING_CHALLENGES_DRAWN);
    expect(shown.items.some((row) => row.challenge === 'probe-challenge')).toBe(false);
    expect(loaded.some((row) => row.challenge === 'probe-challenge')).toBe(true);
    expect(shown.pageContinues).toBe(true);

    const carried = shownMeetingChallenges(rows, false);
    expect(meetingChallengeLabel(carried.items.length, carried.pageContinues, false)).toBe(
      '25 in the latest 25, not every challenge',
    );
    expect(carried.items.some((row) => row.challenge === 'probe-challenge')).toBe(false);
    expect(meetingChallengeLabel(carried.items.length, carried.pageContinues, true)).toBe(
      'Show fewer (25 in the latest 25, not every challenge)',
    );

    const shortLoaded = rows.slice(0, 4).slice(0, meetingChallengeQueryTake(src));
    const shortPage = meetingChallengePage(shortLoaded);
    const short = shownMeetingChallenges(shortPage.items, shortPage.pageContinues);
    expect(short.pageContinues).toBe(false);
    expect(short.items).toHaveLength(4);
    expect(meetingChallengeLabel(short.items.length, short.pageContinues, false)).toBe('Show all 4');
    expect(meetingChallengeLabel(short.items.length, short.pageContinues, false)).not.toMatch(
      /not every/i,
    );
    expect(meetingChallengeLabel(short.items.length, short.pageContinues, true)).toBe('Show fewer');
    expect(meetingChallengeLabel(MEETING_CHALLENGES_DRAWN, false, false)).toBe('Show all 25');
  });
});
