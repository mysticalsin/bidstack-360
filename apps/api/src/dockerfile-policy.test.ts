import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const dockerfile = readFileSync(path.join(process.cwd(), 'Dockerfile'), 'utf8');

function finalStage(source: string) {
  const from = [...source.matchAll(/^FROM /gm)];
  const last = from.at(-1);
  if (!last || last.index === undefined) throw new Error('standalone API Dockerfile has no FROM');
  return source.slice(last.index);
}

describe('standalone API Dockerfile policy', () => {
  it('probes /readyz so an orchestrator can tell a live process from a ready one', () => {
    const runtime = finalStage(dockerfile);
    // WHY: Checkov CKV_DOCKER_2 and Trivy DS-0026 fail this file on main.
    // The image runs migrations and then the API. Without a HEALTHCHECK, a
    // process that is up but cannot serve still looks healthy.
    expect(runtime, 'CKV_DOCKER_2 / DS-0026: the runtime stage needs a HEALTHCHECK for /readyz').toMatch(
      /HEALTHCHECK[\s\S]*\/readyz/,
    );
    expect(runtime).toContain('USER bidstack');
    expect(runtime.lastIndexOf('USER bidstack')).toBeLessThan(runtime.indexOf('CMD ['));
    expect(runtime.lastIndexOf('USER ')).toBeGreaterThan(-1);
    expect(runtime.slice(runtime.lastIndexOf('USER '))).not.toMatch(/^USER\s+root\b/);
  });

  it('makes Checkov fail the supply-chain job when the user or the healthcheck is missing', () => {
    const workflow = readFileSync(
      path.resolve(process.cwd(), '../../.github/workflows/supply-chain.yml'),
      'utf8',
    );
    // WHY: inventory #408 rows 5 and 16. Checkov already reports CKV_DOCKER_3 and
    // CKV_DOCKER_2, and soft_fail lets the job conclude success. Those two rules
    // have to fail the job. Other findings stay advisory.
    expect(workflow).toMatch(/hard_fail_on:\s*CKV_DOCKER_2,CKV_DOCKER_3/);
    expect(workflow).toMatch(/soft_fail:\s*true/);
  });
});
