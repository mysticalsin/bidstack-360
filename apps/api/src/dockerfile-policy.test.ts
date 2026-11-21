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
  });
});
