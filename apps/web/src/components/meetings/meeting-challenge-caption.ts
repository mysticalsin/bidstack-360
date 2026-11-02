/** Challenges the account card treats as the whole rollup. The route reads one past this page. */
export const MEETING_CHALLENGES_DRAWN = 25;

/**
 * Challenges to draw. The extra row only says another challenge exists. It is
 * not shown, and it is not a total.
 */
export function meetingChallengePage<T>(
  rows: readonly T[],
  drawn = MEETING_CHALLENGES_DRAWN,
): { items: T[]; pageContinues: boolean } {
  const pageContinues = rows.length > drawn;
  return {
    items: pageContinues ? rows.slice(0, drawn) : [...rows],
    pageContinues,
  };
}

/**
 * Challenges the card draws. The API drops the probe and sets
 * `challengesContinue`. A response that still carries that row is paged here
 * so the probe is not shown.
 */
export function shownMeetingChallenges<T>(
  items: readonly T[],
  challengesContinue: boolean | undefined,
  drawn = MEETING_CHALLENGES_DRAWN,
): { items: T[]; pageContinues: boolean } {
  if (items.length > drawn) return meetingChallengePage(items, drawn);
  return { items: [...items], pageContinues: Boolean(challengesContinue) };
}

/**
 * Challenge control on the account card. A longer loaded list is the latest
 * challenges, not every challenge. A shorter list keeps "Show all N" and
 * "Show fewer". No challenge total is invented.
 */
export function meetingChallengeLabel(count: number, pageContinues: boolean, open: boolean): string {
  if (pageContinues) {
    const page = `${count} in the latest ${count}, not every challenge`;
    return open ? `Show fewer (${page})` : page;
  }
  if (open) return 'Show fewer';
  return `Show all ${count}`;
}
