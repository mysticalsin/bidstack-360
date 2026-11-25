// The activity step used to open /contacts and talk about a contact timeline.
// Contacts never renders [data-tour="activity-timeline"], so the tour painted
// a full dark sheet and cut no hole. The marker is on the account cockpit,
// and only when that account has activity. CI Financial is the seeded
// account (ACCOUNT_KEY ci-financial) whose open follow-up fills that list.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { TOUR_STEPS } from './tour-steps';

const srcRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = join(srcRoot, '..', '..', '..');

describe('activity tour step', () => {
  it('opens the seeded account timeline instead of the contacts list', () => {
    const step = TOUR_STEPS.find((item) => item.id === 'activity-timeline');
    const contacts = readFileSync(join(srcRoot, 'pages/ContactsPage.tsx'), 'utf8');
    const timeline = readFileSync(
      join(srcRoot, 'components/cockpit/ActivityTimelineCard.tsx'),
      'utf8',
    );
    const dashboard = readFileSync(join(srcRoot, 'pages/DashboardPage.tsx'), 'utf8');
    const seed = readFileSync(join(repoRoot, 'packages/db/src/seed.ts'), 'utf8');
    const opps = readFileSync(join(repoRoot, 'packages/db/src/seed-data.ts'), 'utf8');
    const tasks = readFileSync(join(repoRoot, 'packages/db/src/seed-data.tasks-leads.ts'), 'utf8');

    expect(contacts).not.toContain('data-tour="activity-timeline"');
    expect(timeline).toContain('data-tour="activity-timeline"');
    expect(dashboard).toContain('<ActivityTimelineCard');
    expect(dashboard).toContain('function AccountCockpitPage');
    expect(seed).toContain("const ACCOUNT_KEY = 'ci-financial'");
    expect(opps).toMatch(/code: 'OP-2041'[\s\S]*?customer: 'CI Financial'/);
    expect(tasks).toContain("oppCode: 'OP-2041'");

    expect(step?.route).toBe('/accounts/ci-financial');
    expect(step?.target).toBe('[data-tour="activity-timeline"]');
    expect(step?.body ?? '').not.toMatch(/contact timeline/i);
    expect(step?.body).toBe(
      'Follow-ups, calls, and notes for this account sit on its timeline.',
    );
  });
});
