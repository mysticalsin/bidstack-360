import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const dockerfile = readFileSync(path.resolve(process.cwd(), 'container/Dockerfile'), 'utf8');

function finalStage(source: string) {
  const from = [...source.matchAll(/^FROM /gm)];
  const last = from.at(-1);
  if (!last || last.index === undefined) throw new Error('preview container Dockerfile has no FROM');
  return source.slice(last.index);
}

describe('Polo preview container Dockerfile policy', () => {
  it('publishes a non-root stage with a healthcheck and no secret baked into ENV or ARG', () => {
    const runtime = finalStage(dockerfile);
    // WHY: the parked preview image on #189 was flagged for running as root
    // (DS-0002, CKV_DOCKER_3, Semgrep missing-user), for a missing HEALTHCHECK
    // (DS-0026, CKV_DOCKER_2), and for POSTGRES_PASSWORD in ENV (DS-0031).
    // Those files are not on main. This image must not grow the same shape.
    const users = [...runtime.matchAll(/^USER\s+(\S+)/gm)].map((match) => match[1]);
    expect(users.at(-1)).toBe('postgres');
    expect(runtime).toMatch(/^HEALTHCHECK /m);
    expect(runtime.indexOf('USER postgres')).toBeLessThan(runtime.indexOf('ENTRYPOINT'));
    expect(dockerfile).not.toMatch(/POSTGRES_PASSWORD/);
    expect(dockerfile).not.toMatch(/DATABASE_URL/);
    expect(dockerfile).not.toMatch(/^\s*(?:ENV|ARG)\s+[A-Z0-9_]*(?:PASSWORD|SECRET|TOKEN)\b/m);
  });
});
