import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(process.cwd(), '..', '..');
const workerDockerfile = readFileSync(path.join(repoRoot, 'apps/worker/Dockerfile'), 'utf8');
const rootPackage = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as {
  packageManager?: string;
};

function runtimeStage() {
  const marker = 'FROM node:${NODE_VERSION} AS runtime';
  const start = workerDockerfile.indexOf(marker);
  if (start === -1) throw new Error('worker Dockerfile runtime stage is missing');
  return workerDockerfile.slice(start);
}

describe('standalone worker Dockerfile policy', () => {
  it('uses the workspace-pinned pnpm version', () => {
    const expectedPnpmVersion = rootPackage.packageManager?.replace(/^pnpm@/, '');

    expect(expectedPnpmVersion).toBeTruthy();
    expect(workerDockerfile).toContain(`ARG PNPM_VERSION=${expectedPnpmVersion}`);
  });

  it('keeps the production runtime non-root, healthchecked, and tool-pruned', () => {
    const runtime = runtimeStage();

    expect(runtime).toContain('RUN addgroup -S bidstack && adduser -S -G bidstack bidstack');
    expect(runtime).toContain('COPY --chown=bidstack:bidstack --from=builder /app ./');
    expect(runtime).toContain('USER bidstack');
    expect(runtime).toContain('HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3');
    expect(runtime).toContain('CMD curl -f http://localhost:4002/health || exit 1');
    expect(runtime).toContain('/usr/local/bin/pnpm');
    expect(runtime).toContain('/usr/local/lib/node_modules/corepack');
    expect(runtime.indexOf('USER bidstack')).toBeLessThan(runtime.indexOf('CMD ["node", "dist/main.js"]'));
  });
});
