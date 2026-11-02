import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { KAM_TODO_PAGE, kamTodoCaption, kamTodoEmptyMessage } from './kam-todo-caption';

/**
 * The account to-do reads one task past the page. A card that prints the
 * page's open and done lengths as the account totals is the false read.
 */
function todoListProbes(apiSrc: string): boolean {
  const route = apiSrc.slice(apiSrc.indexOf("'/kam/accounts/:companyId/todos'"));
  return (
    /const KAM_TODO_PAGE = 999/.test(route) &&
    /take:\s*KAM_TODO_PAGE\s*\+\s*1/.test(route) &&
    /const pageContinues = loaded\.length > KAM_TODO_PAGE/.test(route) &&
    /pageContinues \? loaded\.slice\(0, KAM_TODO_PAGE\)/.test(route) &&
    /pageContinues,/.test(route) &&
    !/\.count\(/.test(route)
  );
}

describe('key-account to-do caption', () => {
  it('does not call the loaded page every task when a later task was loaded', () => {
    // WHY: the to-do fetched take:999 and printed that slice as
    // "N open · M done". Those counts are the page. One more loaded row
    // means the drawn tasks are not every task. The extra row is dropped.
    // A shorter page keeps "N open · M done". No task total is invented.
    const panelSrc = readFileSync(path.resolve(process.cwd(), 'src/pages/kam/kamPanels.tsx'), 'utf8');
    const apiSrc = readFileSync(
      path.resolve(process.cwd(), '../../apps/api/src/routes/kam-tasks.ts'),
      'utf8',
    );
    const card = panelSrc.slice(
      panelSrc.indexOf('export function KamTodoCard'),
      panelSrc.indexOf('ABC OM handoffs'),
    );
    expect(todoListProbes(apiSrc)).toBe(true);
    expect(card).toContain('const pageContinues = Boolean(data?.pageContinues)');
    expect(card).toContain(
      'kamTodoCaption(data?.openCount ?? 0, data?.doneCount ?? 0, pageContinues, latest)',
    );
    expect(card).not.toMatch(/caption=\{`\$\{data\?\.openCount/);
    expect(card).not.toMatch(/\.count\(/);

    const drawn = KAM_TODO_PAGE;
    const loaded = Array.from({ length: drawn + 1 }, (_, n) => ({
      open: n % 4 !== 0,
    }));
    const pageContinues = todoListProbes(apiSrc) && loaded.length > drawn;
    const page = pageContinues ? loaded.slice(0, drawn) : loaded;
    const openCount = page.filter((task) => task.open).length;
    const doneCount = page.length - openCount;
    expect(pageContinues).toBe(true);
    expect(page).toHaveLength(drawn);
    expect(kamTodoCaption(openCount, doneCount, pageContinues, page.length)).toBe(
      `${openCount} open · ${doneCount} done in the latest ${drawn}, not every task`,
    );
    expect(kamTodoEmptyMessage(true)).toBe(
      `No open task in the latest ${drawn}, not every task.`,
    );

    const short = loaded.slice(0, 3);
    const shortContinues = short.length > drawn;
    const shortOpen = short.filter((task) => task.open).length;
    const shortDone = short.length - shortOpen;
    expect(shortContinues).toBe(false);
    expect(kamTodoCaption(shortOpen, shortDone, shortContinues, short.length)).toBe(
      `${shortOpen} open · ${shortDone} done`,
    );
    expect(kamTodoCaption(shortOpen, shortDone, shortContinues, short.length)).not.toMatch(
      /not every/i,
    );
    expect(kamTodoEmptyMessage(false)).toBe("No open tasks across this account's initiatives.");
    expect(kamTodoEmptyMessage(false)).not.toMatch(/not every/i);
  });
});
