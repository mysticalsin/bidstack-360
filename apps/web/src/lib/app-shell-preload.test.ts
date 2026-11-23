import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

// index.html is the document for every route. A fetch preload of the web
// manifest is not consumed by <link rel="manifest">, so Chrome warns that
// the preload was unused on each navigation.
const html = readFileSync(path.resolve(process.cwd(), 'index.html'), 'utf8');

describe('app shell manifest preload', () => {
  it('keeps the manifest link and does not preload manifest.json', () => {
    expect(html).toContain('rel="manifest" href="/manifest.json"');
    expect(html).not.toMatch(/rel="preload"[^>]*href="\/manifest\.json"/);
    expect(html).not.toMatch(/href="\/manifest\.json"[^>]*rel="preload"/);
  });
});
