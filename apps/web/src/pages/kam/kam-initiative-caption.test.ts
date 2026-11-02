import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { kamInitiativeColumnHeading } from './kam-initiative-caption';

/**
 * The initiative list reads one past the page. A board that ignores
 * nextCursor prints each column's loaded length as that stage.
 */
function initiativeListProbes(apiSrc: string, hookSrc: string): boolean {
  const route = apiSrc.slice(apiSrc.indexOf("'/kam/initiatives'"));
  const get = route.slice(0, route.indexOf('Get one'));
  const probes =
    /limit:\s*z\.coerce\.number\(\)\.int\(\)\.min\(1\)\.max\(100\)\.default\(50\)/.test(get) &&
    /take:\s*limit\s*\+\s*1/.test(get) &&
    /const hasMore = rows\.length > limit/.test(get) &&
    /nextCursor: hasMore/.test(get);
  const hook = hookSrc.slice(hookSrc.indexOf('function useKamInitiatives'));
  const fn = hook.slice(0, hook.indexOf('function useTransitionInitiative'));
  const asksPastThePage = /limit=/.test(fn);
  return probes && !asksPastThePage;
}

describe('key-account initiative columns', () => {
  it('does not call a column the whole stage when a later initiative was loaded', () => {
    // WHY: the board fetched the default page of 50 and printed each column's
    // loaded length as that stage ("Initiatives · 12"). The list already
    // drops one later row into nextCursor. Ignoring that cursor left the
    // column count as if the page were every initiative. A continued page
    // says the drawn cards are not every initiative. A shorter page keeps
    // "Stage · N". No initiative total is invented.
    const boardSrc = readFileSync(path.resolve(process.cwd(), 'src/pages/kam/kamPanels.tsx'), 'utf8');
    const hookSrc = readFileSync(path.resolve(process.cwd(), 'src/hooks/useKam.ts'), 'utf8');
    const apiSrc = readFileSync(
      path.resolve(process.cwd(), '../../apps/api/src/routes/kam-initiatives.ts'),
      'utf8',
    );
    const board = boardSrc.slice(
      boardSrc.indexOf('export function KamInitiativeBoard'),
      boardSrc.indexOf('Per-account to-do'),
    );
    expect(initiativeListProbes(apiSrc, hookSrc)).toBe(true);
    expect(board).toContain('const pageContinues = Boolean(data?.nextCursor)');
    expect(board).toContain('const latest = items.length');
    expect(board).toContain(
      'kamInitiativeColumnHeading(STAGE_LABEL[stage], col.length, pageContinues, latest)',
    );
    expect(board).not.toMatch(/STAGE_LABEL\[stage\]\} · \{col\.length\}/);
    expect(board).not.toMatch(/initiativesByStage/);
    expect(board).not.toMatch(/\.count\(/);

    const drawn = 50;
    const loaded = Array.from({ length: drawn + 1 }, (_, n) => n);
    const pageContinues = initiativeListProbes(apiSrc, hookSrc) && loaded.length > drawn;
    const cards = pageContinues ? loaded.slice(0, drawn) : loaded;
    const inStage = cards.filter((n) => n % 5 === 0);
    expect(pageContinues).toBe(true);
    expect(cards).toHaveLength(drawn);
    expect(kamInitiativeColumnHeading('Initiatives', inStage.length, pageContinues, cards.length)).toBe(
      `Initiatives · ${inStage.length} in the latest ${drawn}, not every initiative`,
    );
    expect(kamInitiativeColumnHeading('Dropped', 0, pageContinues, cards.length)).toBe(
      `Dropped · 0 in the latest ${drawn}, not every initiative`,
    );

    const short = loaded.slice(0, 3);
    const shortContinues = short.length > drawn;
    expect(shortContinues).toBe(false);
    expect(kamInitiativeColumnHeading('Leads', short.length, shortContinues, short.length)).toBe(
      'Leads · 3',
    );
    expect(
      kamInitiativeColumnHeading('Leads', short.length, shortContinues, short.length),
    ).not.toMatch(/not every/i);
  });
});
