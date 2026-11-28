// WHY: Tony asked for a floor plan before any new screen. The rail in
// navConfig.ts is the shell that plan has to name. A new route that skips
// the plan fails this test, which is the point of the gate.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { ADMIN_SETTINGS, NAV_SECTIONS } from './navConfig';

const floorPlanPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../../docs/floor-plans/polo-app-floor-plan.md',
);

describe('Polo app floor plan', () => {
  it('names every primary route and requires a plan before a new screen', () => {
    const text = readFileSync(floorPlanPath, 'utf8');
    expect(text).toMatch(/before any new screen/i);
    const routes = [
      ...NAV_SECTIONS.flatMap((section) => section.items.map((item) => item.to)),
      ...ADMIN_SETTINGS.map((item) => item.to),
    ];
    for (const route of routes) {
      expect(text, route).toContain(`\`${route}\``);
    }
  });
});
