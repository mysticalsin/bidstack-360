import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { ROUTING_RULE_LIST_PAGE, routingRuleListCaption } from './routing-rule-list-caption';

/**
 * The routing-rule list reads one row past the page. A caption that prints the
 * loaded length as the whole set is the false read.
 */
function routingRuleListProbes(apiSrc: string): boolean {
  const route = apiSrc.slice(apiSrc.indexOf("'/lead-routing-rules'"));
  const get = route.slice(0, route.indexOf('// POST /api/lead-routing-rules'));
  return (
    /const ROUTING_RULE_LIST_PAGE = 500/.test(get) &&
    /take:\s*ROUTING_RULE_LIST_PAGE\s*\+\s*1/.test(get) &&
    /const pageContinues = loaded\.length > ROUTING_RULE_LIST_PAGE/.test(get) &&
    /pageContinues \? loaded\.slice\(0, ROUTING_RULE_LIST_PAGE\)/.test(get) &&
    /pageContinues,/.test(get) &&
    !/\.count\(/.test(get)
  );
}

describe('routing rule list caption', () => {
  it('does not call the loaded page every routing rule when a later row was loaded', () => {
    // WHY: GET /lead-routing-rules fetched take:500 and the list printed that
    // length as "{{count}} total". One more loaded row means the drawn rows
    // are not every routing rule. The extra row is dropped. A shorter page
    // keeps "N total". No routing-rule total is invented.
    const panelSrc = readFileSync(
      path.resolve(process.cwd(), 'src/pages/territoriesPage/TerritoryPanels.tsx'),
      'utf8',
    );
    const pageSrc = readFileSync(path.resolve(process.cwd(), 'src/pages/TerritoriesPage.tsx'), 'utf8');
    const hookSrc = readFileSync(path.resolve(process.cwd(), 'src/hooks/useTerritories.ts'), 'utf8');
    const apiSrc = readFileSync(
      path.resolve(process.cwd(), '../../apps/api/src/routes/territories-routing.ts'),
      'utf8',
    );
    expect(routingRuleListProbes(apiSrc)).toBe(true);
    expect(panelSrc).toContain('routingRuleListCaption(items.length, true, ROUTING_RULE_LIST_PAGE)');
    expect(pageSrc).toContain('const rulesPageContinues = Boolean(rules.data?.pageContinues)');
    expect(pageSrc).toContain('pageContinues={rulesPageContinues}');
    const rulesHook = hookSrc.slice(
      hookSrc.indexOf('export function useLeadRoutingRules'),
      hookSrc.indexOf('export function useCreateLeadRoutingRule'),
    );
    expect(rulesHook).toContain('pageContinues: boolean');
    expect(pageSrc).not.toMatch(/leadRoutingRule\.count\(/);
    expect(apiSrc.slice(apiSrc.indexOf("'/lead-routing-rules'"), apiSrc.indexOf('// POST /api/lead-routing-rules'))).not.toMatch(/\.count\(/);

    const drawn = ROUTING_RULE_LIST_PAGE;
    const loaded = Array.from({ length: drawn + 1 }, (_, n) => n);
    const pageContinues = routingRuleListProbes(apiSrc) && loaded.length > drawn;
    const page = pageContinues ? loaded.slice(0, drawn) : loaded;
    expect(pageContinues).toBe(true);
    expect(page).toHaveLength(drawn);
    expect(routingRuleListCaption(page.length, pageContinues, drawn)).toBe(
      `${drawn} in the latest ${drawn}, not every routing rule`,
    );

    const short = loaded.slice(0, 3);
    const shortContinues = short.length > drawn;
    expect(shortContinues).toBe(false);
    expect(routingRuleListCaption(short.length, shortContinues, short.length)).toBe(
      `${short.length} total`,
    );
    expect(routingRuleListCaption(short.length, shortContinues, short.length)).not.toMatch(
      /not every/i,
    );
  });
});
