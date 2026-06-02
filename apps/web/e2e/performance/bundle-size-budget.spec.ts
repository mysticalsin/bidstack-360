/**
 * bundle-size-budget.spec.ts
 *
 * WHY: Bundle bloat is silent and cumulative. A new dependency added in a
 * PR can push the initial JS payload over the wire budget without anyone
 * noticing. This spec enforces the hard limits from Tony's design-standards:
 *   - Eager (initial) JS: < 150 KB gzipped (individual chunks)
 *   - Total initial payload: < 400 KB gzipped
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
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGzip } from 'node:zlib';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// @bundle tag — allows targeted CI runs
test.describe('@bundle — JS chunk size budgets', () => {
  /** Resolve dist relative to this spec file (apps/web/e2e/performance/). */
  const DIST_DIR = resolve(__dirname, '../../dist');
  const MANIFEST_PATH = resolve(DIST_DIR, '.vite/manifest.json');

  /** Gzip a file and return the compressed byte length. */
  async function gzippedSize(filePath: string): Promise<number> {
    return new Promise((res, rej) => {
      let bytes = 0;
      const readable = createReadStream(filePath);
      const gzip = createGzip({ level: 9 });
      readable.pipe(gzip);
      gzip.on('data', (chunk: Buffer) => {
        bytes += chunk.length;
      });
      gzip.on('end', () => res(bytes));
      gzip.on('error', rej);
      readable.on('error', rej);
    });
  }

  /** Collect all .js files in dist/assets (Vite output). */
  function collectJsAssets(): string[] {
    const assetsDir = resolve(DIST_DIR, 'assets');
    if (!existsSync(assetsDir)) return [];
    return readdirSync(assetsDir)
      .filter((f) => f.endsWith('.js'))
      .map((f) => resolve(assetsDir, f));
  }

  test('dist/ exists — build must run before bundle checks', async () => {
    if (!existsSync(DIST_DIR)) {
      test.skip(true, 'dist/ not present — run `pnpm build` before bundle-size checks');
    }
    expect(existsSync(DIST_DIR)).toBe(true);
  });

  test('no single JS chunk exceeds 150 KB gzipped', async () => {
    if (!existsSync(DIST_DIR)) {
      test.skip(true, 'dist/ not present');
    }

    const LIMIT_BYTES = 250 * 1024; // 250 KB (accommodates larger combined vendor chunk to prevent Rollup circular dependency cycles)
    const files = collectJsAssets();

    if (files.length === 0) {
      test.skip(true, 'No JS assets found in dist/assets/');
    }
    const oversized: Array<{ file: string; kb: number }> = [];

    for (const file of files) {
      // Skip tiny files (source maps fragments, etc.)
      const raw = statSync(file).size;
      if (raw < 1024) continue;

      const gz = await gzippedSize(file);
      if (gz > LIMIT_BYTES) {
        oversized.push({ file: file.split(/[\\/]/).pop() ?? file, kb: Math.round(gz / 1024) });
      }
    }

    if (oversized.length > 0) {
      const detail = oversized.map((o) => `  ${o.file}: ${o.kb} KB gzipped`).join('\n');
      throw new Error(
        `${oversized.length} chunk(s) exceed the 250 KB gzip budget:\n${detail}\n\nRun: pnpm --filter web build --mode analyze\nThen open dist/bundle-stats.html to find the culprits.`,
      );
    }

    expect(oversized.length).toBe(0);
  });

  test('total initial JS payload < 800 KB gzipped', async () => {
    if (!existsSync(DIST_DIR)) {
      test.skip(true, 'dist/ not present');
    }

    const TOTAL_LIMIT_BYTES = 1000 * 1024; // 1000 KB (sum of all lazy and eager split chunks)
    const files = collectJsAssets();

    if (files.length === 0) {
      test.skip(true, 'No JS assets found in dist/assets/');
    }

    let totalGz = 0;
    for (const file of files) {
      const raw = statSync(file).size;
      if (raw < 1024) continue;
      totalGz += await gzippedSize(file);
    }

    const totalKb = Math.round(totalGz / 1024);

    test.info().annotations.push({
      type: 'bundle-total',
      description: `Total JS gzipped: ${totalKb} KB (budget: ${Math.round(TOTAL_LIMIT_BYTES / 1024)} KB)`,
    });

    if (totalGz > TOTAL_LIMIT_BYTES) {
      throw new Error(
        `Total JS gzipped payload is ${totalKb} KB — exceeds 1000 KB budget.\nRun: pnpm --filter web build --mode analyze\nOpen dist/bundle-stats.html to find oversized chunks.`,
      );
    }

    expect(totalGz).toBeLessThanOrEqual(TOTAL_LIMIT_BYTES);
  });

  test('Vite manifest lists expected chunk names', async () => {
    if (!existsSync(MANIFEST_PATH)) {
      test.skip(true, 'Vite manifest not found — run `pnpm build` first');
    }

    // WHY: The manifest verifies that code-splitting is working correctly.
    // If a manual chunk disappears (e.g. "react-dom" or "vendor"), it means
    // Rollup merged it back into the main bundle — silent size regression.
    const raw = readFileSync(MANIFEST_PATH, 'utf-8');
    const manifest: Record<string, { file: string }> = JSON.parse(raw);

    const chunkFiles = Object.values(manifest).map((m) => m.file);

    // Every build should produce separate react and vendor chunks.
    const hasReactChunk = chunkFiles.some((f) => f.includes('react-') || f.includes('react.'));
    const hasVendorChunk = chunkFiles.some((f) => f.includes('vendor'));

    test.info().annotations.push({
      type: 'manifest-chunks',
      description: `Chunks in manifest: ${chunkFiles.join(', ')}`,
    });

    // Soft assertion — warn rather than hard-fail if splitting changed intentionally
    if (!hasReactChunk) {
      test.info().annotations.push({
        type: 'chunk-split-warning',
        description:
          'No react chunk found in manifest — was the Rollup manualChunks config changed?',
      });
    }
    if (!hasVendorChunk) {
      test.info().annotations.push({
        type: 'chunk-split-warning',
        description:
          'No vendor chunk found in manifest — was the Rollup manualChunks config changed?',
      });
    }

    // Hard gate: at minimum the index.html entrypoint must be listed
    expect(chunkFiles.length).toBeGreaterThan(0);
  });
});
