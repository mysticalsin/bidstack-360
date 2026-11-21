import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const dockerfile = readFileSync(path.resolve(process.cwd(), 'Dockerfile'), 'utf8');

function finalStage(source: string) {
  const from = [...source.matchAll(/^FROM /gm)];
  const last = from.at(-1);
  if (!last || last.index === undefined) throw new Error('marketing Dockerfile has no FROM');
  return source.slice(last.index);
}

describe('marketing Dockerfile policy', () => {
  it('names nginx as the runtime user so the image is not scanned as root', () => {
    const runtime = finalStage(dockerfile);
    // WHY: Checkov CKV_DOCKER_3 and Trivy DS-0002 (HIGH) read the Dockerfile,
    // not the nginx-unprivileged default. A missing USER is reported as root.
    const users = [...runtime.matchAll(/^USER\s+(\S+)/gm)].map((match) => match[1]);
    expect(users, 'CKV_DOCKER_3 / DS-0002: the runtime stage needs a non-root USER').toEqual(['nginx']);
  });
});
