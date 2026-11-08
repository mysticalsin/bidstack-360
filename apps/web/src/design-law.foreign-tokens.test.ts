// The design-law rule must catch the shadcn foreground/background names that
// slipped through as live leftovers (funnel-chart, sankey-node,
// chart-stat-flow): @theme does not define them, so they rendered unstyled.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Linter } from 'eslint';
import { describe, expect, it } from 'vitest';

// The rule lives outside the web tsconfig (plain JS), so load it by URL.
const RULES_URL = pathToFileURL(join(process.cwd(), '../../packages/eslint-rules/design-law.js')).href;
const designLaw = (await import(/* @vite-ignore */ RULES_URL)).default;

function lint(code: string) {
  const linter = new Linter({ configType: 'flat' });
  return linter.verify(code, [
    {
      plugins: { 'bidstack-design': designLaw },
      rules: { 'bidstack-design/no-foreign-token-vocabulary': 'error' },
    },
  ]);
}

// Built at runtime: as literals these fixtures would trip the rule under test.
const cls = (utility: string, name: string) => [utility, name].join('-');

describe('no-foreign-token-vocabulary', () => {
  it.each([
    cls('text', 'foreground'),
    cls('bg', 'foreground'),
    cls('text', 'background'),
    cls('bg', 'background'),
    cls('fill', 'foreground'),
    cls('stroke', 'foreground'),
    cls('text', 'muted-foreground'),
  ])('flags %s', (name) => {
    const messages = lint(`const c = "font-medium ${name} text-sm";`);
    expect(messages.map((m) => m.messageId)).toContain('foreignToken');
  });

  it('flags opacity and variant forms', () => {
    expect(lint(`const c = "hover:${cls('text', 'foreground')}/70";`)).toHaveLength(1);
  });

  it('leaves repo tokens alone', () => {
    expect(lint('const c = "text-fg-primary bg-surface-page fill-fg-secondary text-fg-inverted";')).toHaveLength(0);
  });

  it('no live leftovers remain in the chart kit', () => {
    for (const rel of [
      'src/components/charts/funnel-chart.tsx',
      'src/components/charts/sankey/sankey-node.tsx',
      'src/components/charts/chart-stat-flow.tsx',
    ]) {
      const src = readFileSync(join(process.cwd(), rel), 'utf8');
      expect(src, rel).not.toMatch(/(?:^|[\s"'`:])(?:text|bg|fill|stroke)-(?:foreground|background)(?=$|[\s"'`/])/m);
    }
  });
});
