// The open-total value has to stay fully readable in the 150px tile.
// nowrap plus ellipsis clipped "EUR 10.0bn" (135px of text in a 129px box)
// on the account page at 1280. The unit job has no Playwright browser, so
// this locks the layout rule that removed the clip.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(join(process.cwd(), 'src/components/positioning/positioning.css'), 'utf8');

describe('key number value at 1280', () => {
  it('wraps EUR 10.0bn and CA$102.2M instead of clipping them', () => {
    // WHY: ellipsis hides the amount. The copy stays; the value has to wrap.
    const rule = css.match(/^\.kn-value \{([^}]+)\}/m)?.[1] ?? '';
    expect(rule).toMatch(/overflow-wrap:\s*anywhere/);
    expect(rule).not.toMatch(/white-space:\s*nowrap/);
    expect(rule).not.toMatch(/text-overflow:\s*ellipsis/);
    expect(rule).not.toMatch(/overflow:\s*hidden/);
  });
});
