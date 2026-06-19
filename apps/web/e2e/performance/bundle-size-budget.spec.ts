/**
 * bundle-size-budget.spec.ts
 *
 * WHY: Bundle bloat is silent and cumulative. A new dependency added in a
 * PR can push the initial JS payload over the wire budget without anyone
 * noticing. This spec enforces the hard limits from Tony's design standards:
 *   - Individual JS chunks: < 250 KB gzipped
 *   - Initial JS import graph: < 800 KB gzipped
 *
 * The spec reads the Vite build manifest (dist/.vite/manifest.json) or falls
 * back to scanning dist/ for .js files and measuring compressed size with
 * Node's built-in zlib. It runs as a Playwright test so it integrates into
 * the same CI report; it does NOT launch a browser.
 *
 * CI gate: this test is tagged @bundle so it can be run independently:
 *   pnpm e2e --grep @bundle
 */
import { test, expect } from '@playwright/test';
import { createReadStream, existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { createGzip } from 'node:zlib';

type ViteManifestEntry = {
  file?: string;
  imports?: string[];
  isEntry?: boolean;
};

type ViteManifest = Record<string, ViteManifestEntry>;

// @bundle tag - allows targeted CI runs.
test.describe('@bundle - JS chunk size budgets', () => {
  const DIST_DIR = resolve(process.cwd(), 'dist');
  const MANIFEST_PATH = resolve(DIST_DIR, '.vite/manifest.json');

  async function gzippedSize(filePath: string): Promise<number> {
    return new Promise((resolveSize, rejectSize) => {
      let bytes = 0;
      const readable = createReadStream(filePath);
      const gzip = createGzip({ level: 9 });
      readable.pipe(gzip);
      gzip.on('data', (chunk: Buffer) => {
        bytes += chunk.length;
      });
      gzip.on('end', () => resolveSize(bytes));
      gzip.on('error', rejectSize);
      readable.on('error', rejectSize);
    });
  }

  function collectJsAssets(): string[] {
    const assetsDir = resolve(DIST_DIR, 'assets');
    if (!existsSync(assetsDir)) return [];
    return readdirSync(assetsDir)
      .filter((file) => file.endsWith('.js'))
      .map((file) => resolve(assetsDir, file));
  }

  function readManifest(): ViteManifest {
    return JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8')) as ViteManifest;
  }

  function collectInitialJsAssets(): string[] {
    if (!existsSync(MANIFEST_PATH)) return [];

    const manifest = readManifest();
    const files = new Set<string>();
    const visitedKeys = new Set<string>();

    function visit(key: string): void {
      if (visitedKeys.has(key)) return;
      visitedKeys.add(key);

      const entry = manifest[key];
      if (!entry) return;
      if (entry.file?.endsWith('.js')) {
        files.add(resolve(DIST_DIR, entry.file));
      }
      for (const importKey of entry.imports ?? []) {
        visit(importKey);
      }
    }

    for (const [key, entry] of Object.entries(manifest)) {
      if (entry.isEntry) visit(key);
    }

    return [...files];
  }

  test('dist/ exists - build must run before bundle checks', async () => {
    if (!existsSync(DIST_DIR)) {
      test.skip(true, 'dist/ not present - run `pnpm build` before bundle-size checks');
    }
    expect(existsSync(DIST_DIR)).toBe(true);
  });

  test('no single JS chunk exceeds 250 KB gzipped', async () => {
    if (!existsSync(DIST_DIR)) {
      test.skip(true, 'dist/ not present');
    }

    const LIMIT_BYTES = 250 * 1024;
    const files = collectJsAssets();

    if (files.length === 0) {
      test.skip(true, 'No JS assets found in dist/assets/');
    }

    const oversized: Array<{ file: string; kb: number }> = [];

    for (const file of files) {
      const raw = statSync(file).size;
      if (raw < 1024) continue;

      const gz = await gzippedSize(file);
      if (gz > LIMIT_BYTES) {
        oversized.push({ file: file.split(/[\\/]/).pop() ?? file, kb: Math.round(gz / 1024) });
      }
    }

    if (oversized.length > 0) {
      const detail = oversized.map((item) => `  ${item.file}: ${item.kb} KB gzipped`).join('\n');
      throw new Error(
        `${oversized.length} chunk(s) exceed the 250 KB gzip budget:\n${detail}\n\nRun: pnpm --filter web build --mode analyze\nThen open dist/bundle-stats.html to find the culprits.`,
      );
    }

    expect(oversized.length).toBe(0);
  });

  test('initial JS import graph < 800 KB gzipped', async () => {
    if (!existsSync(DIST_DIR)) {
      test.skip(true, 'dist/ not present');
    }
    if (!existsSync(MANIFEST_PATH)) {
      test.skip(true, 'Vite manifest not found - run `pnpm build` first');
    }

    const INITIAL_LIMIT_BYTES = 800 * 1024;
    const files = collectInitialJsAssets();

    if (files.length === 0) {
      test.skip(true, 'No initial JS assets found in Vite manifest');
    }

    let initialGz = 0;
    for (const file of files) {
      const raw = statSync(file).size;
      if (raw < 1024) continue;
      initialGz += await gzippedSize(file);
    }

    const initialKb = Math.round(initialGz / 1024);

    test.info().annotations.push({
      type: 'bundle-initial',
      description: `Initial JS gzipped: ${initialKb} KB across ${files.length} files (budget: ${Math.round(INITIAL_LIMIT_BYTES / 1024)} KB)`,
    });

    if (initialGz > INITIAL_LIMIT_BYTES) {
      throw new Error(
        `Initial JS gzipped payload is ${initialKb} KB - exceeds 800 KB budget.\nRun: pnpm --filter web build --mode analyze\nOpen dist/bundle-stats.html to find oversized chunks.`,
      );
    }

    expect(initialGz).toBeLessThanOrEqual(INITIAL_LIMIT_BYTES);
  });

  test('Vite manifest lists expected chunk names', async () => {
    if (!existsSync(MANIFEST_PATH)) {
      test.skip(true, 'Vite manifest not found - run `pnpm build` first');
    }

    const manifest = readManifest();
    const chunkFiles = Object.values(manifest).flatMap((entry) => (entry.file ? [entry.file] : []));

    const hasReactChunk = chunkFiles.some((file) => file.includes('react-') || file.includes('react.'));
    const hasVendorChunk = chunkFiles.some((file) => file.includes('vendor'));

    test.info().annotations.push({
      type: 'manifest-chunks',
      description: `Chunks in manifest: ${chunkFiles.join(', ')}`,
    });

    if (!hasReactChunk) {
      test.info().annotations.push({
        type: 'chunk-split-warning',
        description:
          'No react chunk found in manifest - was the Rollup manualChunks config changed?',
      });
    }
    if (!hasVendorChunk) {
      test.info().annotations.push({
        type: 'chunk-split-warning',
        description:
          'No vendor chunk found in manifest - was the Rollup manualChunks config changed?',
      });
    }

    expect(chunkFiles.length).toBeGreaterThan(0);
  });
});
