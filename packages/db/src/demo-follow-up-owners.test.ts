import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { DEMO_FOLLOW_UPS, DEMO_VISITOR_ASSIGNEE } from './demo-follow-up-owners.js';

// A new demo org files every follow-up on Sofia, Marco, or Priya. The
// signed-in visitor is stored as ME and owns none of them, so the tasks
// list is other people's work. The Siemens technical volume is the
// visitor's in-progress bid. IKEA stays with Marco.
describe('demo follow-up owners', () => {
  it('files the Siemens technical volume on the signed-in visitor', () => {
    const siemens = DEMO_FOLLOW_UPS.find(
      (task) => task.title === 'Finalize technical volume for Siemens ERP',
    );

    expect(DEMO_VISITOR_ASSIGNEE).toBe('ME');
    expect(siemens?.assignee).toBe(DEMO_VISITOR_ASSIGNEE);
    expect(siemens?.status).toBe('in_progress');
  });

  it('leaves a teammate follow-up on that teammate', () => {
    const ikea = DEMO_FOLLOW_UPS.find((task) => task.title === 'Prepare pricing annex for IKEA');

    expect(ikea?.assignee).toBe('MB');
    expect(DEMO_FOLLOW_UPS.some((task) => task.assignee !== DEMO_VISITOR_ASSIGNEE)).toBe(true);
  });

  it('is the list the demo seed writes, joined on the visitor key', () => {
    const src = readFileSync(new URL('./seed-org-data.ts', import.meta.url), 'utf8');

    expect(src).toContain('DEMO_FOLLOW_UPS');
    expect(src).toContain('DEMO_VISITOR_ASSIGNEE');
  });
});
