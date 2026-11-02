import { describe, expect, it } from 'vitest';

import {
  ACCOUNT_WATCH_PROJECTS_DRAWN,
  accountWatchProjectSummary,
  accountWatchProjectToggle,
} from './account-watch-project-caption';

describe('accountWatchProjectSummary', () => {
  it('does not describe fifty projects as every project when another row was loaded', () => {
    // WHY: the track record drew fifty and "50 won, 1 lost" / "Show 51 projects"
    // treated the loaded length as the whole book. One more loaded row means
    // those fifty are not every project. Two that fit keep "1 won, 1 lost".
    // No project total is invented.
    expect(accountWatchProjectSummary(50, 1, true)).toBe(
      '50 in the latest 50, not every project',
    );
    expect(accountWatchProjectSummary(50, 1, true)).not.toBe('50 won, 1 lost');
    expect(accountWatchProjectSummary(50, 1, true)).not.toMatch(/51/);
    expect(accountWatchProjectSummary(1, 1, false)).toBe('1 won, 1 lost');
    expect(accountWatchProjectSummary(1, 1, false)).not.toMatch(/not every/i);
    expect(accountWatchProjectSummary(ACCOUNT_WATCH_PROJECTS_DRAWN, 0, false)).toBe('50 won, 0 lost');
  });

  it('does not print Show all N from the loaded length when the probe row existed', () => {
    // WHY: "Show 51 projects" and "Show all 51" would publish the loaded
    // length as a total. The expander names the drawn page without a count.
    expect(accountWatchProjectToggle(51, false, true)).toBe('Show these projects');
    expect(accountWatchProjectToggle(51, false, true)).not.toMatch(/51/);
    expect(accountWatchProjectToggle(51, false, true)).not.toMatch(/Show all/i);
    expect(accountWatchProjectToggle(51, false, true)).not.toMatch(/View all/i);
    expect(accountWatchProjectToggle(2, false, false)).toBe('Show 2 projects');
    expect(accountWatchProjectToggle(2, true, false)).toBe('Hide projects');
  });
});
