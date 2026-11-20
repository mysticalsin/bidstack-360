// The open-total value has to stay fully readable in the 150px tile.
// nowrap plus ellipsis clipped "EUR 10.0bn" (135px of text in a 129px box)
// on the account page at 1280. The unit job has no Playwright browser, so
// this locks the layout rule that removed the clip.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(join(process.cwd(), 'src/components/positioning/positioning.css'), 'utf8');

const KN_VALUE = /(?:^|[^\w-])\.kn-value(?![\w-])/;

/** Comments are not rules. A commented `.kn-value` block must not count. */
function cssWithoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '');
}

function knValueBlocks(source: string): Array<{ selector: string; body: string }> {
  const blocks: Array<{ selector: string; body: string }> = [];
  for (const match of cssWithoutComments(source).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = (match[1] ?? '').trim();
    if (selector.split(',').some((part) => KN_VALUE.test(part))) {
      blocks.push({ selector, body: match[2] ?? '' });
    }
  }
  return blocks;
}

function clips(body: string): boolean {
  return /white-space:\s*nowrap/.test(body) || /text-overflow:\s*ellipsis/.test(body) || /overflow:\s*hidden/.test(body);
}

function tileValueWraps(source: string): boolean {
  const blocks = knValueBlocks(source);
  const primary = blocks.find((block) => block.selector === '.kn-value');
  if (!primary || !/overflow-wrap:\s*anywhere/.test(primary.body)) return false;
  return blocks.length > 0 && blocks.every((block) => !clips(block.body));
}

const COMMENTED_CLIP = `/*
.kn-value { overflow-wrap: anywhere; }
*/
.kn-value { white-space: nowrap; text-overflow: ellipsis; overflow: hidden; }
`;

const SECOND_BLOCK_CLIPS = `.kn-value { overflow-wrap: anywhere; }
.kn-value { white-space: nowrap; }
`;

describe('key number value at 1280', () => {
  it('does not accept a comment, or a later block, as proof the value wraps', () => {
    // WHY: a comment that contains the wrap rule used to satisfy the first
    // `.kn-value` match, and a second block that still clips was never read.
    const commented = knValueBlocks(COMMENTED_CLIP);
    expect(commented).toHaveLength(1);
    expect(commented[0]?.body).toMatch(/white-space:\s*nowrap/);
    expect(tileValueWraps(COMMENTED_CLIP)).toBe(false);
    expect(knValueBlocks(SECOND_BLOCK_CLIPS)).toHaveLength(2);
    expect(tileValueWraps(SECOND_BLOCK_CLIPS)).toBe(false);
  });

  it('wraps EUR 10.0bn and CA$102.2M instead of clipping them', () => {
    // WHY: ellipsis hides the amount. The copy stays; every `.kn-value` block has to wrap.
    const blocks = knValueBlocks(css);
    expect(blocks.map((block) => block.selector)).toEqual([
      '.kn-value',
      ".kn-tile[data-missing='true'] .kn-value",
      '.kn-tile, .kn-label, .kn-value, .kn-sub, .kn-prov',
    ]);
    expect(tileValueWraps(css)).toBe(true);
  });
});
