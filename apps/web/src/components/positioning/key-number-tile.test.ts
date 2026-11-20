// The open-total value has to be fully readable in the real tile at 1280.
// nowrap plus ellipsis clips "EUR 10.0bn" (136px) inside a ~129px tile.
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const css = readFileSync(join(process.cwd(), 'src/components/positioning/positioning.css'), 'utf8');
// Six health tiles at the 150px floor: the narrow tile Inspector measured (129px of text box).
const STRIP = 6 * 150 + 5 * 8;

const html = (values: string[]) => `<!doctype html>
<meta charset="utf-8" />
<style>${css}</style>
<div style="width:${STRIP}px">
  <section class="kn">
    <ul class="kn-row" data-count="${values.length}">
      ${values
        .map(
          (value, index) => `<li class="kn-tile" data-missing="false" data-testid="tile-${index}">
            <span class="kn-label">Open pipeline</span>
            <span class="kn-value">${value}</span>
            <span class="kn-sub">1 open deal</span>
          </li>`,
        )
        .join('')}
    </ul>
  </section>
</div>`;

describe('key number value at 1280', () => {
  const browser = chromium.launch();

  afterAll(async () => {
    await (await browser).close();
  });

  it('shows EUR 10.0bn and CA$102.2M in full inside the tile', async () => {
    // WHY: ellipsis hides the amount. The layout has to fit the text; the copy stays.
    const page = await (await browser).newPage({ viewport: { width: 1280, height: 800 } });
    await page.setContent(html(['EUR 10.0bn', 'CA$102.2M', '12', '3d ago', '0', 'Neutral']));
    for (const label of ['EUR 10.0bn', 'CA$102.2M']) {
      const box = page.locator('.kn-value', { hasText: label });
      const fit = await box.evaluate((el) => ({
        scroll: el.scrollWidth,
        client: el.clientWidth,
        text: el.textContent,
      }));
      expect(fit.text).toBe(label);
      expect(fit.scroll, `${label} is clipped`).toBeLessThanOrEqual(fit.client);
    }
    await page.close();
  });
});
