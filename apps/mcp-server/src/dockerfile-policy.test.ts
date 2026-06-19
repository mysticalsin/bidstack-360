import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(process.cwd(), '..', '..');
const rootDockerfile = readFileSync(path.join(repoRoot, 'Dockerfile'), 'utf8');

function mcpServerStage() {
  const marker = 'FROM node:${NODE_VERSION} AS mcp-server';
  const start = rootDockerfile.indexOf(marker);
  if (start === -1) throw new Error('root Dockerfile mcp-server stage is missing');
  return rootDockerfile.slice(start);
}

describe('MCP server Dockerfile policy', () => {
  it('keeps exposed ports aligned with the runtime defaults', () => {
    const stage = mcpServerStage();

    expect(stage).toContain('EXPOSE 4001');
    expect(stage).toContain('EXPOSE 4003');
    expect(stage).not.toContain('EXPOSE 3001');
    expect(stage).toContain('CMD curl -f http://localhost:4003/health || exit 1');
  });

  it('runs the production MCP process as a non-root user', () => {
    const stage = mcpServerStage();

    expect(stage).toContain('RUN addgroup -S bidstack && adduser -S -G bidstack bidstack');
    expect(stage).toContain('COPY --chown=bidstack:bidstack --from=builder /app/apps/mcp-server/dist ./apps/mcp-server/dist');
    expect(stage).toContain('USER bidstack');
    expect(stage.indexOf('USER bidstack')).toBeLessThan(stage.indexOf('CMD ["node", "dist/main.js"]'));
  });
});
