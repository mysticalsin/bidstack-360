import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { SLACK_TASK_PAGE, slackTaskTodayHeading } from './slack-task-caption.js';

/**
 * The Slack today list reads one row past the page. A heading that prints
 * the loaded length as every task due today is the false read.
 */
function slackTaskListProbes(src: string): boolean {
  const start = src.indexOf('dueDate: { gte: today');
  const query = src.slice(start, start + 700);
  const helperSrc = readFileSync(
    path.resolve(process.cwd(), 'src/routes/integrations/slack-task-caption.ts'),
    'utf8',
  );
  return (
    /export const SLACK_TASK_PAGE = 10/.test(helperSrc) &&
    /take: SLACK_TASK_PAGE \+ 1/.test(query) &&
    /const pageContinues = tasks\.length > SLACK_TASK_PAGE/.test(src) &&
    /tasks\.slice\(0, SLACK_TASK_PAGE\)/.test(src) &&
    /slackTaskTodayHeading\(/.test(src) &&
    !/count\(/.test(query) &&
    !/take: 10\b/.test(query)
  );
}

describe('slack today task list caption', () => {
  it('does not call the loaded page every task due today when a later row was loaded', () => {
    // WHY: `/bidstack tasks today` read tasks with take: 10 and the Slack
    // reply printed that length as "Your tasks today (N)". The list draws
    // that page. One more loaded row means those drawn rows are not every
    // task due today. The extra row is dropped. A shorter page keeps the
    // old heading. No task total is invented.
    const src = readFileSync(
      path.resolve(process.cwd(), 'src/routes/integrations/slack-commands.ts'),
      'utf8',
    );
    expect(slackTaskListProbes(src)).toBe(true);
    const start = src.indexOf('dueDate: { gte: today');
    expect(src.slice(start, start + 700)).not.toMatch(/count\(/);

    const drawn = SLACK_TASK_PAGE;
    const loaded = Array.from({ length: drawn + 1 }, (_, n) => n);
    const pageContinues = slackTaskListProbes(src) && loaded.length > drawn;
    const page = pageContinues ? loaded.slice(0, drawn) : loaded;
    expect(pageContinues).toBe(true);
    expect(page).toHaveLength(drawn);
    expect(slackTaskTodayHeading(page.length, pageContinues, drawn)).toBe(
      `${drawn} in the latest ${drawn}, not every task`,
    );

    expect(slackTaskTodayHeading(drawn, false, drawn)).toBe(`Your tasks today (${drawn})`);
    expect(slackTaskTodayHeading(1, false)).toBe('Your tasks today (1)');
    expect(slackTaskTodayHeading(drawn, false, drawn)).not.toMatch(/not every/i);

    const short = loaded.slice(0, 3);
    const shortContinues = short.length > drawn;
    expect(shortContinues).toBe(false);
    expect(slackTaskTodayHeading(short.length, shortContinues, short.length)).toBe(
      `Your tasks today (${short.length})`,
    );
    expect(slackTaskTodayHeading(short.length, shortContinues, short.length)).not.toMatch(
      /not every/i,
    );
  });
});
