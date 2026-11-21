/**
 * Resolve Playwright from the web workspace. The journey suite lives at the
 * repo root and does not add a dependency of its own.
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../apps/web/package.json'),
);

export const { test, expect, defineConfig, devices } = require('@playwright/test') as typeof import('@playwright/test');
